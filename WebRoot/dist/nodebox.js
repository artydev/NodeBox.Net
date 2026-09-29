// NodeBox runtime (page side).
//
// Every NodeBox call is recorded into a Float32Array ("frame") instead of
// crossing the WebView2 bridge. Once per frame the buffer is sent to .NET in a
// single call (nb.submit), where FrameRenderer.cs decodes and draws it with
// Direct2D. Keep the opcodes below in sync with FrameRenderer.cs.
//
// State that NodeBox keeps (fill, stroke, strokewidth, transform) is tracked
// here and only written to the frame when it changes.

'use strict';

const NodeBox = (() => {
  const MAGIC = 7001, VERSION = 3;
  const OP = {
    CLEAR: 0, MATRIX: 1, RECT: 2, OVAL: 3, LINE: 4, PATH: 5,
    FILL: 6, NOFILL: 7, STROKE: 8, NOSTROKE: 9, STROKEWIDTH: 10,
    TEXT: 11, FILLGRAD: 12, STROKEGRAD: 13, SHADOW: 14, NOSHADOW: 15,
  };
  const VERB = { MOVETO: 0, LINETO: 1, CURVETO: 2, CLOSE: 3 };
  const VERB_SIZE = [3, 3, 7, 1];   // floats per verb, including the verb code

  // ── Frame buffer ──────────────────────────────────────────────────────────

  let buf = new Float32Array(1 << 14);
  let n = 0;

  function ensure(k) {
    if (n + k <= buf.length) return;
    let size = buf.length * 2;
    while (size < n + k) size *= 2;
    const b = new Float32Array(size);
    b.set(buf.subarray(0, n));
    buf = b;
  }
  function op1(o)                   { ensure(1); buf[n++] = o; }
  function op2(o, a)                { ensure(2); buf[n++] = o; buf[n++] = a; }
  function op5(o, a, b, c, d)       { ensure(5); buf[n++] = o; buf[n++] = a; buf[n++] = b; buf[n++] = c; buf[n++] = d; }

  // ── Graphics state (mirrors the decoder's defaults) ──────────────────────

  // Affine matrix, System.Numerics.Matrix3x2 layout: [m11 m12 m21 m22 m31 m32].
  // Row-vector convention: p' = p · M;  A·B = "apply A, then B".
  let ctm, stack, curPath, emitted, _autoclosepath;

  function resetState() {
    ctm = [1, 0, 0, 1, 0, 0];
    emitted = [1, 0, 0, 1, 0, 0];   // the decoder starts every frame at identity
    stack = [];
    curPath = null;
    _autoclosepath = true;
  }

  function mul(a, b) {
    return [
      a[0] * b[0] + a[1] * b[2],
      a[0] * b[1] + a[1] * b[3],
      a[2] * b[0] + a[3] * b[2],
      a[2] * b[1] + a[3] * b[3],
      a[4] * b[0] + a[5] * b[2] + b[4],
      a[4] * b[1] + a[5] * b[3] + b[5],
    ];
  }
  function concat(m) { ctm = mul(m, ctm); }

  // Transform mode, as in NodeBox 1:
  //   CENTER (default) — rotate()/scale()/skew() pivot around the centre of each
  //                      shape's own bounds:  T(−c) · CTM · T(+c)
  //   CORNER           — they pivot around the origin (plain CTM).
  // Mode is run-level state (set it once at the top, or per shape).
  const CORNER = 'corner';
  let tmode = 'center';

  // size(w, h): a fixed logical canvas, fitted (letterboxed) into the window.
  // root maps logical → window pixels and is appended to every matrix.
  let viewW = 800, viewH = 600;          // window canvas size in CSS px (from the page)
  let logical = null;                    // { w, h } once size() was called
  let root = null, rootScale = 1;
  function computeRoot() {
    if (!logical) { root = null; rootScale = 1; return; }
    const s = Math.min(viewW / logical.w, viewH / logical.h);
    rootScale = s;
    root = [s, 0, 0, s, (viewW - logical.w * s) / 2, (viewH - logical.h * s) / 2];
  }

  const isLinearIdentity = (m) => m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1;

  // Emits the matrix for the next shape. (cx, cy) = centre of that shape's local
  // bounds, used only in CENTER mode when the CTM rotates, scales or skews.
  function flushMatrix(cx = 0, cy = 0) {
    let m = ctm;
    if (tmode === 'center' && !isLinearIdentity(ctm))
      m = mul(mul([1, 0, 0, 1, -cx, -cy], ctm), [1, 0, 0, 1, cx, cy]);
    if (root) m = mul(m, root);
    if (m[0] === emitted[0] && m[1] === emitted[1] && m[2] === emitted[2] &&
        m[3] === emitted[3] && m[4] === emitted[4] && m[5] === emitted[5]) return;
    ensure(7);
    buf[n++] = OP.MATRIX;
    for (let i = 0; i < 6; i++) buf[n++] = m[i];
    emitted = m;
  }
  const needsCenter = () => tmode === 'center' && !isLinearIdentity(ctm);

  // ── Colour ────────────────────────────────────────────────────────────────
  //
  // NodeBox 1 colour model:
  //   colormode(RGB | HSB | CMYK [, range])   how numeric colour arguments are read
  //   colorrange(range)                       1.0 by default; e.g. colorrange(255)
  //   color(...) → Color                      same argument forms as fill()
  //
  // Argument forms accepted by color(), fill(), stroke(), background():
  //   (grey)  (grey, a)                       grey is brightness in every mode
  //   (r, g, b)  (r, g, b, a)                 RGB
  //   (h, s, b)  (h, s, b, a)                 HSB — hue 0-1 wraps around
  //   (c, m, y, k)  (c, m, y, k, a)           CMYK
  //   (Color)  (Color, a)                     a Color object (alpha override optional)
  //   ("#rgb" | "#rrggbb" | "#rrggbbaa" | CSS name) (, a)
  //   ([...])                                 an array of any of the numeric forms
  //
  // Colour mode and range persist for the whole run (set them once in setup()).
  // Values outside the range are clamped (use colorrange(255) for 0-255 values).

  const RGB = 'rgb', HSB = 'hsb', CMYK = 'cmyk';
  let mode = RGB, range = 1;

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v || 0);

  // Random source: Math.random until seed(n) switches to a deterministic
  // generator (mulberry32) — like Python's random.seed() in NodeBox sketches.
  let rng = Math.random;
  function seedRandom(n) {
    let a = (Math.floor(+n * 1000003) ^ 0x9e3779b9) >>> 0;
    rng = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hsbToRgb(h, s, v) {
    h = ((h % 1) + 1) % 1;             // wrap hue
    s = clamp01(s); v = clamp01(v);
    const i = Math.floor(h * 6), f = h * 6 - i;
    const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0: return [v, t, p];
      case 1: return [q, v, p];
      case 2: return [p, v, t];
      case 3: return [p, q, v];
      case 4: return [t, p, v];
      default: return [v, p, q];
    }
  }

  function rgbToHsb(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d > 0) {
      if (max === r)      h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else                h = (r - g) / d + 4;
      h /= 6;
      if (h < 0) h += 1;
    }
    return [h, max === 0 ? 0 : d / max, max];
  }

  function cmykToRgb(c, m, y, k) {
    return [1 - Math.min(1, c * (1 - k) + k),
            1 - Math.min(1, m * (1 - k) + k),
            1 - Math.min(1, y * (1 - k) + k)];
  }

  // CSS colour names / rgb() / hsl() via the browser's own parser (page only).
  // Common CSS named colors so parseCss() works without a canvas (e.g. in tests or
  // before the page is fully loaded). Covers every name in the NodeBox examples.
  const CSS_NAMED = {
    black:[0,0,0,1], white:[1,1,1,1], red:[1,0,0,1], lime:[0,1,0,1], blue:[0,0,1,1],
    yellow:[1,1,0,1], cyan:[0,1,1,1], aqua:[0,1,1,1], magenta:[1,0,1,1], fuchsia:[1,0,1,1],
    silver:[0.753,0.753,0.753,1], gray:[0.502,0.502,0.502,1], grey:[0.502,0.502,0.502,1],
    maroon:[0.502,0,0,1], olive:[0.502,0.502,0,1], green:[0,0.502,0,1],
    purple:[0.502,0,0.502,1], teal:[0,0.502,0.502,1], navy:[0,0,0.502,1],
    orange:[1,0.647,0,1], pink:[1,0.753,0.796,1], brown:[0.647,0.165,0.165,1],
    gold:[1,0.843,0,1], coral:[1,0.498,0.314,1], salmon:[0.98,0.502,0.447,1],
    khaki:[0.941,0.902,0.549,1], tan:[0.824,0.706,0.549,1], beige:[0.961,0.961,0.863,1],
    ivory:[1,1,0.941,1], lavender:[0.902,0.902,0.98,1], violet:[0.933,0.51,0.933,1],
    indigo:[0.294,0,0.510,1], turquoise:[0.251,0.878,0.816,1], crimson:[0.863,0.078,0.235,1],
    transparent:[0,0,0,0],
  };

  let cssCtx = null;
  function parseCss(str) {
    const hex = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(str.trim());
    if (hex) {
      let h = hex[1];
      if (h.length <= 4) h = [...h].map((c) => c + c).join('');
      const v = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
      return [v(0), v(2), v(4), h.length === 8 ? v(6) : 1];
    }
    // Named color fast path — works without a canvas (headless / early init).
    const named = CSS_NAMED[str.trim().toLowerCase()];
    if (named) return named;
    if (typeof document === 'undefined') throw new Error(`Unknown colour "${str}"`);
    cssCtx ??= document.createElement('canvas').getContext('2d');
    cssCtx.fillStyle = '#010203';
    cssCtx.fillStyle = str;
    const out = cssCtx.fillStyle;
    if (out === '#010203' && !/^#?010203$/i.test(str.trim())) throw new Error(`Unknown colour "${str}"`);
    if (out.startsWith('#')) return parseCss(out);
    const m = /rgba?\(([^)]+)\)/.exec(out);          // "rgba(r, g, b, a)"
    const [r, g, b, al = 1] = m[1].split(',').map(Number);
    return [r / 255, g / 255, b / 255, al];
  }

  class Color {
    // Always stores normalised RGBA (0-1). Construct with color(...) instead.
    constructor(r = 0, g = 0, b = 0, a = 1) {
      this._r = clamp01(r); this._g = clamp01(g); this._b = clamp01(b); this._a = clamp01(a);
    }

    // RGBA components (0-1)
    get r() { return this._r; }  set r(v) { this._r = clamp01(v); }
    get g() { return this._g; }  set g(v) { this._g = clamp01(v); }
    get b() { return this._b; }  set b(v) { this._b = clamp01(v); }
    get a() { return this._a; }  set a(v) { this._a = clamp01(v); }
    get alpha() { return this._a; } set alpha(v) { this._a = clamp01(v); }

    // HSB components (0-1) — setting one keeps the other two
    get hsb() { return rgbToHsb(this._r, this._g, this._b); }
    get h() { return this.hsb[0]; }
    get s() { return this.hsb[1]; }
    get brightness() { return this.hsb[2]; }
    get hue() { return this.h; }
    get saturation() { return this.s; }
    set h(v) { const [, s, b] = this.hsb; this._setHsb(v, s, b); }
    set s(v) { const [h, , b] = this.hsb; this._setHsb(h, v, b); }
    set brightness(v) { const [h, s] = this.hsb; this._setHsb(h, s, v); }
    set hue(v) { this.h = v; }
    set saturation(v) { this.s = v; }
    _setHsb(h, s, b) { [this._r, this._g, this._b] = hsbToRgb(h, s, b); }

    // CMYK components (0-1), read-only
    get cmyk() {
      const k = 1 - Math.max(this._r, this._g, this._b);
      if (k >= 1) return [0, 0, 0, 1];
      return [(1 - this._r - k) / (1 - k), (1 - this._g - k) / (1 - k), (1 - this._b - k) / (1 - k), k];
    }
    get c() { return this.cmyk[0]; }
    get m() { return this.cmyk[1]; }
    get y() { return this.cmyk[2]; }
    get k() { return this.cmyk[3]; }

    // Derived colours (return new Color objects; the original is unchanged)
    copy() { return new Color(this._r, this._g, this._b, this._a); }
    withAlpha(a) { return new Color(this._r, this._g, this._b, a); }
    blend(other, t = 0.5) {
      const o = toColor([other]);
      const mix = (x, y) => x + (y - x) * t;
      return new Color(mix(this._r, o._r), mix(this._g, o._g), mix(this._b, o._b), mix(this._a, o._a));
    }
    _hsbAdjust(dh, ds, db) {
      const [h, s, b] = this.hsb;
      const c = new Color(0, 0, 0, this._a);
      c._setHsb(h + dh, s + ds, b + db);
      return c;
    }
    lighten(step = 0.1)    { return this._hsbAdjust(0, 0, step); }
    darken(step = 0.1)     { return this._hsbAdjust(0, 0, -step); }
    saturate(step = 0.1)   { return this._hsbAdjust(0, step, 0); }
    desaturate(step = 0.1) { return this._hsbAdjust(0, -step, 0); }
    rotate(degrees = 30)   { return this._hsbAdjust(degrees / 360, 0, 0); }   // hue shift
    complement()           { return this.rotate(180); }

    get hex() {
      const x = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
      return '#' + x(this._r) + x(this._g) + x(this._b) + (this._a < 1 ? x(this._a) : '');
    }
    toString() { return `Color(r=${this._r.toFixed(3)}, g=${this._g.toFixed(3)}, b=${this._b.toFixed(3)}, a=${this._a.toFixed(3)})`; }
  }

  // Any accepted argument form → Color, using the current mode and range.
  function toColor(args) {
    if (args.length === 1 && Array.isArray(args[0])) args = args[0];
    const [first] = args;

    if (first instanceof Color) {
      return args.length > 1 ? first.withAlpha(+args[1] / range) : first.copy();
    }
    if (typeof first === 'string') {
      const [r, g, b, a] = parseCss(first);
      return new Color(r, g, b, args.length > 1 ? +args[1] / range : a);
    }

    // Components are read in the current colorrange and clamped to 0-1, like NodeBox.
    const n = args.map((x) => +x / range);

    switch (n.length) {
      case 0: return new Color(0, 0, 0, 1);
      case 1: return new Color(n[0], n[0], n[0], 1);             // grey
      case 2: return new Color(n[0], n[0], n[0], n[1]);          // grey, alpha
    }

    if (mode === HSB) {
      const [r, g, b] = hsbToRgb(n[0], n[1], n[2]);
      return new Color(r, g, b, n.length > 3 ? n[3] : 1);
    }
    if (mode === CMYK) {
      if (n.length < 4) throw new Error('CMYK colours need 4 components: c, m, y, k');
      const [r, g, b] = cmykToRgb(clamp01(n[0]), clamp01(n[1]), clamp01(n[2]), clamp01(n[3]));
      return new Color(r, g, b, n.length > 4 ? n[4] : 1);
    }
    return new Color(n[0], n[1], n[2], n.length > 3 ? n[3] : 1);
  }

  // Current fill/stroke as NodeBox tracks them (so fill() with no args can return them).
  // ── Gradients ─────────────────────────────────────────────────────────────
  //
  //   lineargradient(x0, y0, x1, y1, stops)
  //   radialgradient(cx, cy, r, stops)        radialgradient(cx, cy, rx, ry, stops)
  //   gradient('linear', …) / gradient('radial', …)   same arguments after the kind
  //
  // stops: colours spread evenly — ['red', 'gold', color(0,0,1)] — or explicit
  // [position, colour] pairs — [[0, 'white'], [0.6, base], [1, 'black']]. Stops may
  // also be passed as separate trailing arguments. Coordinates are in the current
  // user space, so gradients follow translate()/scale()/rotate() like shapes do.
  // Use with fill(), stroke() or background().

  class Gradient {
    constructor(kind, coords, stops) {
      this.kind = kind;            // 'linear' | 'radial'
      this.coords = coords;        // linear: x0 y0 x1 y1 · radial: cx cy rx ry
      this.stops = stops;          // [[t, Color], …] sorted by t
    }
    toString() { return `Gradient(${this.kind}, ${this.stops.length} stops)`; }
  }

  function parseStops(list) {
    if (list.length === 1 && Array.isArray(list[0]) && !isPair(list[0])) list = list[0];
    if (list.length < 2) throw new Error('A gradient needs at least 2 colour stops');
    const stops = list.map((item, k) => isPair(item)
      ? [clamp01(+item[0]), toColor([item[1]])]
      : [k / (list.length - 1), toColor([item])]);
    return stops.sort((a, b) => a[0] - b[0]);
  }
  // [position, colour] — a number followed by something that is not a number.
  function isPair(x) { return Array.isArray(x) && x.length === 2 && typeof x[0] === 'number' && typeof x[1] !== 'number'; }

  function makeGradient(kind, args) {
    const num = (k) => typeof args[k] === 'number' && Number.isFinite(args[k]);
    if (kind === 'linear') {
      if (![0, 1, 2, 3].every(num)) throw new Error('lineargradient(x0, y0, x1, y1, stops)');
      return new Gradient('linear', args.slice(0, 4), parseStops(args.slice(4)));
    }
    if (kind === 'radial') {
      if (![0, 1, 2].every(num)) throw new Error('radialgradient(cx, cy, r, stops) or (cx, cy, rx, ry, stops)');
      // (cx, cy, rx, ry, stops…) when a 4th number is followed by at least 2 stops.
      const elliptical = num(3) && args.length >= 6 || (num(3) && args.length === 5 && Array.isArray(args[4]));
      const [cx, cy, rx] = args, ry = elliptical ? args[3] : rx;
      return new Gradient('radial', [cx, cy, rx, ry], parseStops(args.slice(elliptical ? 4 : 3)));
    }
    throw new Error(`Unknown gradient kind "${kind}" (use 'linear' or 'radial')`);
  }

  function emitGradient(op, g) {
    ensure(7 + g.stops.length * 5);
    buf[n++] = op;
    buf[n++] = g.kind === 'radial' ? 1 : 0;
    for (let i = 0; i < 4; i++) buf[n++] = g.coords[i];
    buf[n++] = g.stops.length;
    for (const [t, c] of g.stops) { buf[n++] = t; buf[n++] = c.r; buf[n++] = c.g; buf[n++] = c.b; buf[n++] = c.a; }
  }

  // Current paint (Color | Gradient | null) and shadow, as NodeBox tracks them.
  let curFill, curStroke, curShadow;
  function resetColorState() { curFill = new Color(0, 0, 0, 1); curStroke = null; curShadow = null; }

  function emitFill(p) {
    if (p == null) op1(OP.NOFILL);
    else if (p instanceof Gradient) emitGradient(OP.FILLGRAD, p);
    else op5(OP.FILL, p.r, p.g, p.b, p.a);
  }
  function emitStroke(p) {
    if (p == null) op1(OP.NOSTROKE);
    else if (p instanceof Gradient) emitGradient(OP.STROKEGRAD, p);
    else op5(OP.STROKE, p.r, p.g, p.b, p.a);
  }
  function emitShadow(sh) {
    if (!sh) { op1(OP.NOSHADOW); return; }
    ensure(8);
    buf[n++] = OP.SHADOW;
    buf[n++] = sh.color.r; buf[n++] = sh.color.g; buf[n++] = sh.color.b; buf[n++] = sh.color.a;
    buf[n++] = sh.blur * rootScale; buf[n++] = sh.dx * rootScale; buf[n++] = sh.dy * rootScale;
  }
  const paintArg = (a) => (a.length === 1 && a[0] instanceof Gradient ? a[0] : toColor(a));
  const copyPaint = (p) => (p instanceof Color ? p.copy() : p ?? null);

  // ── Text ──────────────────────────────────────────────────────────────────
  //
  // NodeBox 1 text model: font(name, size), fontsize(), lineheight() (multiple of
  // the size, default 1.2), align(LEFT|CENTER|RIGHT|JUSTIFY). text(s, x, y, width)
  // draws with the current FILL; y is the baseline of the first line. With a width
  // the text wraps in a box; without one, align() anchors the line at x.
  // Text state persists for the whole run (set it once in setup()).

  const LEFT = 'left', RIGHT = 'right', CENTER = 'center', JUSTIFY = 'justify';
  const ALIGN_CODE = { left: 0, right: 1, center: 2, justify: 3 };   // = DWRITE_TEXT_ALIGNMENT
  const SEP = '\u001f';                                              // string-table separator

  let fontName, fontSize, lineH, alignCode;
  function resetTextState() { fontName = 'Helvetica'; fontSize = 24; lineH = 1.2; alignCode = 0; }
  resetTextState();

  // Per-frame string table: TEXT ops reference strings by index.
  let strs = [], strIndex = new Map();
  function intern(s) {
    let k = strIndex.get(s);
    if (k === undefined) { k = strs.length; strs.push(s); strIndex.set(s, k); }
    return k;
  }
  const clean = (s) => String(s ?? '').replaceAll(SEP, '');

  // Synchronous measurement through the bridge (DirectWrite — same layout as drawing),
  // memoised because textwidth() is typically called every frame with the same text.
  let measurer = null;
  const measureCache = new Map();
  function measure(txt, width) {
    const s = clean(txt), w = +width > 0 ? +width : 0;
    const key = `${fontName}${SEP}${fontSize}${SEP}${lineH}${SEP}${alignCode}${SEP}${w}${SEP}${s}`;
    let m = measureCache.get(key);
    if (m) return m;
    if (!measurer) throw new Error('Text measurement is not available (host not ready).');
    const out = String(measurer(s, fontName, fontSize, lineH, alignCode, w));
    if (out.startsWith('error')) throw new Error('measure: ' + out.slice(6));
    const [mw, mh, mb] = out.split(' ').map(Number);
    m = { width: mw, height: mh, baseline: mb };
    if (measureCache.size > 4096) measureCache.clear();
    measureCache.set(key, m);
    return m;
  }

  // ── Paths ─────────────────────────────────────────────────────────────────
  //
  // A BezierPath is a list of verbs in the wire encoding
  //   0 x y | 1 x y | 2 c1x c1y c2x c2y x y | 3 (close contour)
  // so drawing one is a straight copy into the frame. Paths are values: build
  // them with beginpath()/endpath(), textpath(), or new BezierPath(); draw them
  // with drawpath(p) or p.draw() (current fill/stroke/transform apply).

  class BezierPath {
    constructor(verbs) { this._v = verbs ? Array.from(verbs) : []; }

    moveto(x, y)  { this._v.push(VERB.MOVETO, +x, +y); return this; }
    lineto(x, y)  { this._v.push(VERB.LINETO, +x, +y); return this; }
    curveto(c1x, c1y, c2x, c2y, x, y) {
      this._v.push(VERB.CURVETO, +c1x, +c1y, +c2x, +c2y, +x, +y); return this;
    }
    closepath()   { this._v.push(VERB.CLOSE); return this; }

    draw() { emitPath(this._v); return this; }
    copy() { return new BezierPath(this._v); }

    // Number of elements (verbs) — NodeBox's len(path).
    get count() { let k = 0; this.forEach(() => k++); return k; }

    // NodeBox path elements: [{cmd, x, y, ctrl1: {x, y}, ctrl2: {x, y}}, …]
    // (cmd = MOVETO | LINETO | CURVETO | CLOSE).
    get elements() {
      const out = [];
      let last = { x: 0, y: 0 };
      this.forEach((cmd, p) => {
        if (cmd === 'close') { out.push({ cmd, x: last.x, y: last.y, ctrl1: { ...last }, ctrl2: { ...last } }); return; }
        const end = p[p.length - 1];
        out.push({ cmd, x: end.x, y: end.y,
          ctrl1: cmd === 'curveto' ? p[0] : { ...end }, ctrl2: cmd === 'curveto' ? p[1] : { ...end } });
        last = end;
      });
      return out;
    }

    // Arc length of the whole path — NodeBox's path.length.
    get length() { return segmentsOf(this._v).reduce((s, g) => s + g.len, 0); }

    // Point at t ∈ [0, 1] along the path (by length), as a PathElement-like {x, y, …}.
    point(t) { return pointOn(segmentsOf(this._v), t); }

    // `amount` points spread evenly along the path (t = 0 … 1), like NodeBox.
    points(amount = 100) {
      const segs = segmentsOf(this._v);
      if (!segs.length) throw new Error('The given path is empty');
      const out = [];
      const d = amount > 1 ? 1 / (amount - 1) : 1;
      for (let i = 0; i < amount; i++) out.push(pointOn(segs, i * d));
      return out;
    }

    // Is (x, y) inside the path? Nonzero winding, like Cocoa's containsPoint.
    contains(x, y) { return containsPoint(this._v, +x, +y); }

    // Calls fn(cmd, points) per verb; cmd is 'moveto' | 'lineto' | 'curveto' | 'close'.
    forEach(fn) {
      const v = this._v, names = ['moveto', 'lineto', 'curveto', 'close'];
      for (let i = 0; i < v.length; i += VERB_SIZE[v[i]] ?? 1) {
        const pts = [];
        for (let j = i + 1; j < i + VERB_SIZE[v[i]]; j += 2) pts.push({ x: v[j], y: v[j + 1] });
        fn(names[v[i]], pts);
      }
    }

    // Every on-curve and control point, as {x, y} (raw geometry, e.g. for bounds).
    get controlpoints() { const out = []; this.forEach((_, p) => out.push(...p)); return out; }

    // New path with every point (incl. control points) passed through fn(x, y) → [x, y].
    // The heart of text distortion: textpath('Hi', 0, 100).map((x, y) => [x, y + Math.sin(x) * 5])
    map(fn) {
      const v = this._v.slice();
      for (let i = 0; i < v.length; i += VERB_SIZE[v[i]] ?? 1) {
        for (let j = i + 1; j < i + VERB_SIZE[v[i]]; j += 2) {
          const [x, y] = fn(v[j], v[j + 1]);
          v[j] = +x; v[j + 1] = +y;
        }
      }
      return new BezierPath(v);
    }

    // Bounding box of all points (control points included, so it may be slightly generous).
    get bounds() { return boundsOf(this._v); }

    // The contours (sub-paths) as separate BezierPaths — e.g. one per letter part.
    get contours() {
      const out = []; let cur = null;
      const v = this._v;
      for (let i = 0; i < v.length; i += VERB_SIZE[v[i]] ?? 1) {
        if (v[i] === VERB.MOVETO || !cur) { cur = new BezierPath(); out.push(cur); }
        for (let j = i; j < i + VERB_SIZE[v[i]]; j++) cur._v.push(v[j]);
        if (v[i] === VERB.CLOSE) cur = null;
      }
      return out;
    }
  }

  // ── Path geometry helpers ──

  function boundsOf(v) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < v.length; i += VERB_SIZE[v[i]] ?? 1) {
      for (let j = i + 1; j < i + VERB_SIZE[v[i]]; j += 2) {
        const x = v[j], y = v[j + 1];
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    return x0 === Infinity ? { x: 0, y: 0, width: 0, height: 0 }
                           : { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }

  const cubic = (p0, p1, p2, p3, t) => {
    const u = 1 - t;
    return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
  };

  // Drawable segments with approximate lengths (curves sampled, like NodeBox's n = 10… we use 20).
  function segmentsOf(v) {
    const segs = [];
    let px = 0, py = 0, sx = 0, sy = 0;
    for (let i = 0; i < v.length; i += VERB_SIZE[v[i]] ?? 1) {
      const c = v[i];
      if (c === VERB.MOVETO) { px = sx = v[i + 1]; py = sy = v[i + 2]; continue; }
      if (c === VERB.LINETO || c === VERB.CLOSE) {
        const x = c === VERB.CLOSE ? sx : v[i + 1], y = c === VERB.CLOSE ? sy : v[i + 2];
        segs.push({ kind: 'line', cmd: c === VERB.CLOSE ? 'close' : 'lineto', x0: px, y0: py, x, y, len: Math.hypot(x - px, y - py) });
        px = x; py = y;
        continue;
      }
      const [c1x, c1y, c2x, c2y, x, y] = [v[i + 1], v[i + 2], v[i + 3], v[i + 4], v[i + 5], v[i + 6]];
      let len = 0, qx = px, qy = py;
      for (let k = 1; k <= 20; k++) {
        const t = k / 20;
        const rx = cubic(px, c1x, c2x, x, t), ry = cubic(py, c1y, c2y, y, t);
        len += Math.hypot(rx - qx, ry - qy); qx = rx; qy = ry;
      }
      segs.push({ kind: 'curve', cmd: 'curveto', x0: px, y0: py, c1x, c1y, c2x, c2y, x, y, len });
      px = x; py = y;
    }
    return segs;
  }

  function pointOn(segs, t) {
    if (!segs.length) throw new Error('The given path is empty');
    const total = segs.reduce((s, g) => s + g.len, 0) || 1;
    let target = Math.min(1, Math.max(0, t)) * total;
    let g = segs[segs.length - 1], local = 1;
    for (const s of segs) {
      if (target <= s.len || s === segs[segs.length - 1]) { g = s; local = s.len ? target / s.len : 0; break; }
      target -= s.len;
    }
    local = Math.min(1, Math.max(0, local));
    if (g.kind === 'line') {
      const x = g.x0 + (g.x - g.x0) * local, y = g.y0 + (g.y - g.y0) * local;
      return { cmd: g.cmd, x, y, ctrl1: { x, y }, ctrl2: { x, y } };
    }
    return {
      cmd: 'curveto',
      x: cubic(g.x0, g.c1x, g.c2x, g.x, local), y: cubic(g.y0, g.c1y, g.c2y, g.y, local),
      ctrl1: { x: g.c1x, y: g.c1y }, ctrl2: { x: g.c2x, y: g.c2y },
    };
  }

  // Nonzero winding over the path flattened into polygons (curves → 24 steps).
  function containsPoint(v, x, y) {
    let winding = 0, px = 0, py = 0, sx = 0, sy = 0, open = false;
    const edge = (ax, ay, bx, by) => {
      if (ay <= y) { if (by > y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) > 0) winding++; }
      else if (by <= y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) < 0) winding--;
    };
    const closeFig = () => { if (open) edge(px, py, sx, sy); open = false; };
    for (let i = 0; i < v.length; i += VERB_SIZE[v[i]] ?? 1) {
      const c = v[i];
      if (c === VERB.MOVETO) { closeFig(); px = sx = v[i + 1]; py = sy = v[i + 2]; open = true; }
      else if (c === VERB.LINETO) { edge(px, py, v[i + 1], v[i + 2]); px = v[i + 1]; py = v[i + 2]; open = true; }
      else if (c === VERB.CURVETO) {
        for (let k = 1; k <= 24; k++) {
          const t = k / 24;
          const qx = cubic(px, v[i + 1], v[i + 3], v[i + 5], t), qy = cubic(py, v[i + 2], v[i + 4], v[i + 6], t);
          edge(k === 1 ? px : cubic(px, v[i + 1], v[i + 3], v[i + 5], (k - 1) / 24),
               k === 1 ? py : cubic(py, v[i + 2], v[i + 4], v[i + 6], (k - 1) / 24), qx, qy);
        }
        px = v[i + 5]; py = v[i + 6]; open = true;
      } else if (c === VERB.CLOSE) { closeFig(); px = sx; py = sy; }
    }
    closeFig();
    return winding !== 0;
  }

  // A 2D point, callable with or without `new` (NodeBox: Point(x, y)).
  function Point(x = 0, y = 0) {
    if (!(this instanceof Point)) return new Point(x, y);
    this.x = +x; this.y = +y;
  }
  Point.prototype.toString = function () { return `Point(${this.x}, ${this.y})`; };

  // findpath(): smooth Bézier through points — port of NodeBox's bezier.findpath.
  function findpath(points, curvature = 1) {
    const pts = points.map((p) => (Array.isArray(p) ? { x: +p[0], y: +p[1] } : { x: +p.x, y: +p.y }));
    const path = new BezierPath();
    if (!pts.length) return null;
    path.moveto(pts[0].x, pts[0].y);
    if (pts.length === 1) return path;
    if (pts.length === 2) return path.lineto(pts[1].x, pts[1].y);
    curvature = Math.max(0, Math.min(1, curvature));
    if (curvature === 0) { for (const p of pts) path.lineto(p.x, p.y); return path; }
    const c = 4 + (1 - curvature) * 40, last = pts.length - 1;
    const dx = { 0: 0, [last]: 0 }, dy = { 0: 0, [last]: 0 };
    const bi = { 1: -0.25 };
    const ax = { 1: (pts[2].x - pts[0].x - dx[0]) / 4 }, ay = { 1: (pts[2].y - pts[0].y - dy[0]) / 4 };
    for (let i = 2; i < last; i++) {
      bi[i] = -1 / (c + bi[i - 1]);
      ax[i] = -(pts[i + 1].x - pts[i - 1].x - ax[i - 1]) * bi[i];
      ay[i] = -(pts[i + 1].y - pts[i - 1].y - ay[i - 1]) * bi[i];
    }
    for (let i = last - 1; i >= 1; i--) {
      dx[i] = ax[i] + dx[i + 1] * bi[i];
      dy[i] = ay[i] + dy[i + 1] * bi[i];
    }
    for (let i = 0; i < last; i++) {
      path.curveto(pts[i].x + dx[i], pts[i].y + dy[i],
                   pts[i + 1].x - dx[i + 1], pts[i + 1].y - dy[i + 1],
                   pts[i + 1].x, pts[i + 1].y);
    }
    return path;
  }

  // ── autotext(): Kant Generator Pro grammars (Mark Pilgrim, "Dive Into Python") ──
  // <ref id> defines alternatives, <xref id> picks one at random, <choice> picks a
  // child, <p chance="X"> is included X % of the time, <p class="sentence">
  // capitalises the next word.
  let fileLoader = null;
  function autotext(source) {
    let xml = String(source);
    if (!xml.trimStart().startsWith('<')) {
      if (!fileLoader) throw new Error('autotext(): cannot load files here');
      xml = fileLoader(xml);
    }
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const refs = {};
    for (const r of doc.getElementsByTagName('ref')) refs[r.getAttribute('id')] = r;
    const xrefd = new Set([...doc.getElementsByTagName('xref')].map((e) => e.getAttribute('id')));
    const standalone = Object.keys(refs).filter((k) => !xrefd.has(k));
    if (!standalone.length) throw new Error("autotext(): can't guess the grammar's start");
    const out = [];
    let capitalize = false;
    const elementsOf = (node) => [...node.childNodes].filter((c) => c.nodeType === 1);
    const pick = (node) => { const c = elementsOf(node); return c[Math.floor(Math.random() * c.length)]; };
    function parse(node) {
      if (!node) return;
      if (node.nodeType === 3 || node.nodeType === 4) {           // text / CDATA
        const t = node.data;
        if (capitalize && t.length) { out.push(t[0].toUpperCase(), t.slice(1)); capitalize = false; }
        else out.push(t);
        return;
      }
      if (node.nodeType !== 1) return;                            // comments etc.
      switch (node.tagName) {
        case 'xref': parse(pick(refs[node.getAttribute('id')])); break;
        case 'choice': parse(pick(node)); break;
        case 'p': {
          if (node.getAttribute('class') === 'sentence') capitalize = true;
          const chance = node.getAttribute('chance');
          if (chance !== null && Math.random() * 100 >= +chance) break;
          for (const c of node.childNodes) parse(c);
          break;
        }
        default: for (const c of node.childNodes) parse(c);
      }
    }
    parse(pick(refs[standalone[Math.floor(Math.random() * standalone.length)]]));
    return out.join('');
  }

  function emitPath(v) {
    if (!v || !v.length) return;
    let count = 0;
    for (let i = 0; i < v.length; i += VERB_SIZE[v[i]] ?? 1) count++;
    if (needsCenter()) {
      const b = boundsOf(v);
      flushMatrix(b.x + b.width / 2, b.y + b.height / 2);
    } else {
      flushMatrix();
    }
    ensure(3 + v.length);
    buf[n++] = OP.PATH; buf[n++] = count; buf[n++] = 0;
    for (let i = 0; i < v.length; i++) buf[n++] = v[i];
  }

  // textpath(): glyph outlines from DirectWrite via the bridge, memoised.
  let outliner = null;
  const outlineCache = new Map();
  function b64ToFloats(b64) {
    let bytes;
    if (typeof Uint8Array.fromBase64 === 'function') bytes = Uint8Array.fromBase64(b64);
    else {
      const bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    }
    return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
  }

  // ── Frame lifecycle ───────────────────────────────────────────────────────

  function beginFrame(dpr) {
    n = 0;
    ensure(3);
    buf[n++] = MAGIC; buf[n++] = VERSION; buf[n++] = dpr || 1;
    resetState();        // transform/path state: per frame, like the decoder
    strs = []; strIndex = new Map();
    resetColorState();   // fill black, no stroke: per frame, like the decoder
  }

  // Called once per Run: colour mode/range persist across frames, not runs.
  function resetRun() { mode = RGB; range = 1; resetTextState(); tmode = 'center'; logical = null; computeRoot(); rng = Math.random; }

  // The page reports the canvas size (CSS px) before each frame.
  function setViewport(w, h) {
    if (w > 0 && h > 0 && (w !== viewW || h !== viewH)) { viewW = w; viewH = h; computeRoot(); }
  }

  // End of frame: with size(), paint the letterbox margins outside the logical canvas.
  const MARGIN = [0.13, 0.13, 0.14, 1];
  function endFrame() {
    if (!root) return;
    const [s, , , , ox, oy] = root, w = logical.w * s, h = logical.h * s;
    op1(OP.NOSHADOW); op1(OP.NOSTROKE);
    op5(OP.FILL, ...MARGIN);
    ensure(7); buf[n++] = OP.MATRIX; buf.set([1, 0, 0, 1, 0, 0], n); n += 6; emitted = [1, 0, 0, 1, 0, 0];
    if (ox > 0.5) { op5(OP.RECT, 0, 0, ox, viewH); op5(OP.RECT, ox + w, 0, viewW - ox - w + 1, viewH); }
    if (oy > 0.5) { op5(OP.RECT, 0, 0, viewW, oy); op5(OP.RECT, 0, oy + h, viewW, viewH - oy - h + 1); }
  }

  // Canvas size as the sketch sees it, and window → canvas coordinates (for the mouse).
  const canvasWidth  = () => (logical ? logical.w : viewW);
  const canvasHeight = () => (logical ? logical.h : viewH);
  function toCanvas(x, y) {
    if (!root) return [x, y];
    return [(x - root[4]) / root[0], (y - root[5]) / root[3]];
  }

  function frameStrings() { return strs.join(SEP); }

  function frameBase64() {
    const bytes = new Uint8Array(buf.buffer, 0, n * 4);
    if (typeof bytes.toBase64 === 'function') return bytes.toBase64();
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // ── Public NodeBox API ────────────────────────────────────────────────────

  const api = {
    // canvas
    // size(w, h): a fixed canvas of w × h, scaled to fit the window (letterboxed).
    // Without size(), the canvas is the whole window pane.
    size(w, h) {
      if (!(+w > 0 && +h > 0)) throw new Error('size() needs a positive width and height');
      logical = { w: +w, h: +h };
      computeRoot();
    },
    // background(colour) clears the canvas; background(gradient) paints the whole
    // canvas with the gradient (coordinates in the current user space, no shadow).
    background(...a) {
      if (!a.length) return;
      const p = paintArg(a);
      if (!(p instanceof Gradient)) {
        op5(OP.CLEAR, p.r, p.g, p.b, p.a);
        return p;
      }
      op5(OP.CLEAR, 0, 0, 0, 1);
      emitGradient(OP.FILLGRAD, p);
      op1(OP.NOSTROKE);
      if (curShadow) op1(OP.NOSHADOW);
      flushMatrix(0, 0);
      op5(OP.RECT, -1e6, -1e6, 2e6, 2e6);   // "everything" in user space
      emitFill(curFill);                     // restore paint state
      emitStroke(curStroke);
      if (curShadow) emitShadow(curShadow);
      return p;
    },

    // colour model
    RGB, HSB, CMYK,
    Color,
    color(...a) { return toColor(a); },
    Gradient,
    lineargradient(...a) { return makeGradient('linear', a); },
    radialgradient(...a) { return makeGradient('radial', a); },
    gradient(kind, ...a) { return makeGradient(String(kind).toLowerCase(), a); },
    colormode(m, r) {
      if (m !== undefined) {
        const k = String(m).toLowerCase();
        if (k !== RGB && k !== HSB && k !== CMYK) throw new Error(`Unknown colour mode "${m}" (use RGB, HSB or CMYK)`);
        mode = k;
      }
      if (r !== undefined) api.colorrange(r);
      return mode;
    },
    colorrange(r) {
      if (r !== undefined) {
        if (!(+r > 0)) throw new Error('colorrange must be > 0');
        range = +r;
      }
      return range;
    },

    // paint state — fill()/stroke() take any colour form or a Gradient;
    // with no arguments they return the current paint (Color, Gradient or null)
    fill(...a) {
      if (!a.length) return copyPaint(curFill);
      curFill = paintArg(a);
      emitFill(curFill);
      return curFill;
    },
    nofill()     { curFill = null; op1(OP.NOFILL); },
    stroke(...a) {
      if (!a.length) return copyPaint(curStroke);
      curStroke = paintArg(a);
      emitStroke(curStroke);
      return curStroke;
    },
    nostroke()   { curStroke = null; op1(OP.NOSTROKE); },

    // shadow(colour, blur = 10, dx = 0, dy = 0, opacity = 1) — every following shape
    // casts a soft shadow (Direct2D Shadow effect). Transparency comes from the
    // colour's alpha × opacity, so shadow('black', 12, 0, 8, 0.3) is a 30 % shadow.
    // Semi-transparent shapes cast proportionally lighter shadows.
    // blur/dx/dy are canvas pixels and ignore the transform, like NodeBox/Quartz.
    // With no arguments, returns the current shadow (or null).
    shadow(clr, blur = 10, dx = 0, dy = 0, opacity = 1) {
      if (clr === undefined) return curShadow ? { ...curShadow, color: curShadow.color.copy() } : null;
      const c = toColor([clr]);
      c.a = c.a * clamp01(+opacity);
      curShadow = { color: c, blur: Math.max(0, +blur || 0), dx: +dx || 0, dy: +dy || 0, opacity: clamp01(+opacity) };
      emitShadow(curShadow);
      return curShadow;
    },
    // Changes only the transparency of the current shadow (0 = invisible, 1 = colour alpha).
    shadowopacity(opacity) {
      if (!curShadow) return null;
      if (opacity === undefined) return curShadow.opacity;
      const o = clamp01(+opacity);
      const base = curShadow.opacity > 0 ? curShadow.color.a / curShadow.opacity : curShadow.color.a;
      curShadow.color.a = base * o;
      curShadow.opacity = o;
      emitShadow(curShadow);
      return o;
    },
    noshadow() { curShadow = null; op1(OP.NOSHADOW); },
    strokewidth(w) { op2(OP.STROKEWIDTH, +w || 0); },

    // primitives
    rect(x, y, w, h)  { flushMatrix(+x + w / 2, +y + h / 2); op5(OP.RECT, +x, +y, +w, +h); },
    oval(x, y, w, h)  { flushMatrix(+x + w / 2, +y + h / 2); op5(OP.OVAL, +x, +y, +w, +h); },
    ellipse(x, y, w, h) { api.oval(x, y, w, h); },
    line(x1, y1, x2, y2) { flushMatrix((+x1 + +x2) / 2, (+y1 + +y2) / 2); op5(OP.LINE, +x1, +y1, +x2, +y2); },

    // paths — NodeBox: beginpath(x, y) … moveto/lineto/curveto/closepath … endpath()
    BezierPath,
    beginpath(x, y) {
      curPath = new BezierPath();
      if (x !== undefined && y !== undefined) curPath.moveto(x, y);
      return curPath;
    },
    moveto(x, y)  { (curPath ??= new BezierPath()).moveto(x, y); },
    lineto(x, y)  { (curPath ??= new BezierPath()).lineto(x, y); },
    curveto(c1x, c1y, c2x, c2y, x, y) { (curPath ??= new BezierPath()).curveto(c1x, c1y, c2x, c2y, x, y); },
    closepath()   { curPath?.closepath(); },
    // autoclosepath(true/false): when false, endpath() will not close the path automatically.
    autoclosepath(close = true) { _autoclosepath = !!close; },
    // Returns the BezierPath; draws it unless endpath(false).
    endpath(draw = true) {
      const p = curPath;
      curPath = null;
      if (!p) return null;
      if (_autoclosepath) p.closepath();
      if (draw) p.draw();
      return p;
    },
    drawpath(path) {
      if (!(path instanceof BezierPath)) throw new Error('drawpath() expects a BezierPath');
      path.draw();
    },
    // Text as a BezierPath (not drawn). Same layout rules as text(): y = baseline.
    textpath(txt, x, y, width = 0 /*, height — accepted, ignored */) {
      const s = clean(txt);
      if (!s) return new BezierPath();
      const w = +width > 0 ? +width : 0;
      // Outlines are fetched at the origin and cached, then offset here — so moving
      // text never costs another bridge call.
      const key = `${fontName}${SEP}${fontSize}${SEP}${lineH}${SEP}${alignCode}${SEP}${w}${SEP}${s}`;
      let verbs = outlineCache.get(key);
      if (!verbs) {
        if (!outliner) throw new Error('textpath() is not available (host not ready).');
        const out = String(outliner(s, fontName, fontSize, lineH, alignCode, 0, 0, w));
        if (out.startsWith('error')) throw new Error('textpath: ' + out.slice(6));
        verbs = out ? b64ToFloats(out) : new Float32Array(0);
        if (outlineCache.size > 512) outlineCache.clear();
        outlineCache.set(key, verbs);
      }
      const dx = +x || 0, dy = +y || 0, v = Array.from(verbs);
      if (dx || dy) {
        for (let i = 0; i < v.length; i += VERB_SIZE[v[i]] ?? 1)
          for (let j = i + 1; j < i + VERB_SIZE[v[i]]; j += 2) { v[j] += dx; v[j + 1] += dy; }
      }
      const p = new BezierPath();
      p._v = v;
      return p;
    },

    // transforms — rotate() is counter-clockwise in degrees, as in NodeBox 1
    translate(tx, ty) { concat([1, 0, 0, 1, +tx || 0, +ty || 0]); },
    rotate(deg) {
      const r = -(+deg || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
      concat([c, s, -s, c, 0, 0]);
    },
    scale(sx, sy = sx) { concat([+sx, 0, 0, +sy, 0, 0]); },
    skew(kx, ky = 0) {
      concat([1, Math.tan((+ky || 0) * Math.PI / 180), Math.tan((+kx || 0) * Math.PI / 180), 1, 0, 0]);
    },
    push()  { stack.push(ctm.slice()); },
    pop()   { if (stack.length) ctm = stack.pop(); },
    reset() { ctm = [1, 0, 0, 1, 0, 0]; },
    CORNER,
    // transform(CENTER | CORNER): how rotate/scale/skew pivot (see flushMatrix).
    transform(m) {
      if (m !== undefined) {
        const k = String(m).toLowerCase();
        if (k !== 'center' && k !== CORNER) throw new Error(`Unknown transform mode "${m}" (use CENTER or CORNER)`);
        tmode = k;
      }
      return tmode;
    },

    // text
    LEFT, RIGHT, CENTER, JUSTIFY,
    font(name, size) {
      if (name !== undefined && name !== null) fontName = clean(name) || 'Helvetica';
      if (size !== undefined) api.fontsize(size);
      return fontName;
    },
    fontsize(size) {
      if (size !== undefined) {
        if (!(+size >= 0)) throw new Error('fontsize must be ≥ 0');
        fontSize = +size;
      }
      return fontSize;
    },
    lineheight(h) {
      if (h !== undefined) {
        if (!(+h > 0)) throw new Error('lineheight must be > 0');
        lineH = +h;
      }
      return lineH;
    },
    align(a) {
      if (a !== undefined) {
        const code = typeof a === 'number' ? a : ALIGN_CODE[String(a).toLowerCase()];
        if (!(code >= 0 && code <= 3)) throw new Error(`Unknown alignment "${a}" (use LEFT, CENTER, RIGHT or JUSTIFY)`);
        alignCode = code;
      }
      return [LEFT, RIGHT, CENTER, JUSTIFY][alignCode];
    },
    text(txt, x, y, width = 0 /*, height — accepted, ignored */) {
      const s = clean(txt);
      if (!s || !(fontSize > 0)) return;          // NodeBox draws nothing at size 0
      x = +x || 0; y = +y || 0;
      if (needsCenter()) {
        // CENTER mode pivots around the centre of the laid-out glyph box.
        const m = measure(s, width);
        const w = +width > 0 ? +width : 0;
        const left = w ? x + (alignCode === 1 ? w - m.width : alignCode === 2 ? (w - m.width) / 2 : 0)
                       : x - (alignCode === 2 ? m.width / 2 : alignCode === 1 ? m.width : 0);
        flushMatrix(left + m.width / 2, y - m.baseline + m.height / 2);
      } else {
        flushMatrix();
      }
      ensure(9);
      buf[n++] = OP.TEXT;
      buf[n++] = intern(s);
      buf[n++] = intern(fontName);
      buf[n++] = fontSize;
      buf[n++] = lineH;
      buf[n++] = alignCode;
      buf[n++] = +x || 0;
      buf[n++] = +y || 0;
      buf[n++] = +width > 0 ? +width : 0;
    },
    // NodeBox returns (width, height); this array also has .width/.height/.baseline.
    textmetrics(txt, width = 0) {
      const m = measure(txt, width);
      return Object.assign([m.width, m.height], m);
    },
    textwidth(txt, width = 0)  { return measure(txt, width).width; },
    textheight(txt, width = 0) { return measure(txt, width).height; },

    // NodeBox shapes that return (and by default draw) a BezierPath
    star(x, y, points = 20, outer = 100, inner = 50, draw = true) {
      const p = new BezierPath().moveto(x, y + outer);
      for (let i = 1; i < 2 * points; i++) {
        const a = i * Math.PI / points, r = i % 2 ? inner : outer;
        p.lineto(x + r * Math.sin(a), y + r * Math.cos(a));
      }
      p.closepath();
      if (draw) p.draw();
      return p;
    },
    NORMAL: 'normal', FORTYFIVE: 'fortyfive',
    arrow(x, y, width = 100, type = 'normal', draw = true) {
      const p = new BezierPath().moveto(x, y);
      if (type === 'fortyfive') {
        const head = 0.3, tail = 1 + head;
        p.lineto(x, y + width * (1 - head)).lineto(x - width * head, y + width)
         .lineto(x - width * head, y + width * tail * 0.4).lineto(x - width * tail * 0.6, y + width)
         .lineto(x - width, y + width * tail * 0.6).lineto(x - width * tail * 0.4, y + width * head)
         .lineto(x - width, y + width * head).lineto(x - width * (1 - head), y).lineto(x, y);
      } else {
        const head = width * 0.4, tail = width * 0.2;
        p.lineto(x - head, y + head).lineto(x - head, y + tail).lineto(x - width, y + tail)
         .lineto(x - width, y - tail).lineto(x - head, y - tail).lineto(x - head, y - head).lineto(x, y)
         .closepath();
      }
      if (draw) p.draw();
      return p;
    },
    Point,
    findpath,
    autotext,
    MOVETO: 'moveto', LINETO: 'lineto', CURVETO: 'curveto', CLOSE: 'close',

    // utilities — random() is always a float (JS can't tell 10 from 10.0);
    // randint(a, b) is NodeBox's integer form: randint(n) → 0…n−1, randint(a, b) → a…b inclusive.
    randint(a, b) {
      if (b === undefined) return Math.floor(rng() * a);
      const lo = Math.min(a, b), hi = Math.max(a, b);
      return Math.floor(lo + rng() * (hi - lo + 1));
    },
    // seed(n): make random()/randint()/choice() repeatable; seed() → back to truly random.
    seed(n) { if (n === undefined || n === null) rng = Math.random; else seedRandom(n); },

    // NodeBox geo: angle in degrees from (x0,y0) to (x1,y1), distance, and the point
    // at `distance` along `angle` from (x0,y0).
    angle(x0, y0, x1, y1) { return Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI; },
    distance(x0, y0, x1, y1) { return Math.hypot(x1 - x0, y1 - y0); },
    coordinates(x0, y0, dist, angle) {
      const r = angle * Math.PI / 180;
      return [x0 + Math.cos(r) * dist, y0 + Math.sin(r) * dist];
    },
    // reflect(x, y, vx, vy): reflect point (vx, vy) through (x, y) — the mirror image.
    reflect(x, y, vx, vy) { return [2 * x - vx, 2 * y - vy]; },
    random(lo = 1, hi) {
      if (hi === undefined) { hi = lo; lo = 0; }
      return lo + rng() * (hi - lo);
    },
    choice(list) { return list[Math.floor(rng() * list.length)]; },
    // grid(cols, rows, colSize, rowSize, shuffled): points row by row. Each point is
    // an [x, y] array that also has .x/.y — for (const [x, y] of grid(…)) works.
    grid(cols, rows, colSize = 1, rowSize = 1, shuffled = false) {
      const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
      const rs = [...Array(Math.floor(rows)).keys()], cs = [...Array(Math.floor(cols)).keys()];
      if (shuffled) { shuffle(rs); shuffle(cs); }
      const pts = [];
      for (const r of rs)
        for (const c of cs) {
          const x = c * colSize, y = r * rowSize;
          pts.push(Object.assign([x, y], { x, y }));
        }
      return pts;
    },

    // speed(fps): set the animation target frame rate. 24 = film, 30 = default, 60 = smooth.
    // In NodeBox for Windows the renderer drives at 60 fps; speed() is honoured by the page.
    speed(fps) { if (typeof _setSpeed === 'function') _setSpeed(+fps || 30); },

    // variable() type constants (NodeBox 1 var() types)
    NUMBER: 'number', TEXT: 'text', BOOLEAN: 'boolean', BUTTON: 'button',
  };

  // _setSpeed callback — set by the page so speed() calls reach the animation loop.
  let _setSpeed = null;

  return {
    api, beginFrame, resetRun, frameBase64, frameStrings,
    setMeasurer(fn) { measurer = fn; },
    setOutliner(fn) { outliner = fn; },
    setFileLoader(fn) { fileLoader = fn; },
    setSpeedCallback(fn) { _setSpeed = fn; },
    setViewport, endFrame, toCanvas,
    get width() { return canvasWidth(); },
    get height() { return canvasHeight(); },
    get length() { return n; },
  };
})();
