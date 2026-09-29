// Ported from "nebula.py" by Tom De Smedt (NodeBox 1, GPL).
// Original: http://nodebox.net/code/index.php/Nebula
// JavaScript port for NodeBox for Windows.

// A local geo namespace (mirrors the nodebox.geo module from NodeBox 1).
const geo = {
  reflect(x, y, vx, vy) { return [2 * x - vx, 2 * y - vy]; },
};

// ── Helper: create a random point with a Bézier control handle ──────────────
function makePoint(x, y, handleX, handleY) {
  return { x, y, ctrl1: { x: handleX, y: handleY } };
}

// ── points(n, vx, vy, h, v) ─────────────────────────────────────────────────
// Returns n random points in a portion [h[0]…h[0]+h[1]] × [v[0]…v[0]+v[1]]
// of the canvas, each with a common handle offset (vx, vy).
function makePoints(n, vx, vy, h, v) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const px = WIDTH * h[0] + random(WIDTH  * (h[1] - h[0]));
    const py = HEIGHT * v[0] + random(HEIGHT * (v[1] + v[0]));
    pts.push(makePoint(px, py, px + vx, py + vy));
  }
  return pts;
}

// ── merge(points, x, y, vx, vy, reflected, d) ───────────────────────────────
// Build a single BezierPath: smooth curves from every point to the focus (x, y).
function merge(pts, x, y, vx, vy, reflected, d) {
  reflected = !!reflected;
  d = d || 0;
  beginpath(0, 0);
  for (const pt of pts) {
    let vx0, vy0;
    if (!reflected) {
      vx0 = pt.ctrl1.x;
      vy0 = pt.ctrl1.y;
    } else {
      [vx0, vy0] = geo.reflect(pt.x, pt.y, pt.ctrl1.x, pt.ctrl1.y);
    }
    moveto(pt.x, pt.y);
    curveto(vx0, vy0, vx, vy, x + random(-d, d), y + random(-d, d));
  }
  return endpath(false);   // autoclosepath(false) keeps paths open
}

// ── nebula(clr, options) ─────────────────────────────────────────────────────
function nebula(clr, {
  bg         = true,
  n          = 100,
  d          = 300,
  angle      = 0.5,
  iterations = 100,
  tonality   = 0.1,
  growth     = [1.01, 1.01, 0.98],
} = {}) {

  // Wrap a value into [0, base].
  function wrapAround(v, base) {
    base = base || 1;
    if (v < 0) return base - v;
    if (v > base) return v - base;
    return v;
  }

  // Draw a transformed copy of `path` at the current matrix.
  function drawTransformed(path, dx, dy, ang, scaling) {
    rotate(ang);
    drawpath(path.copy());
    scale(scaling);
    translate(dx, dy);
  }

  colormode(HSB);
  if (bg) {
    background(clr.hue, clr.saturation, Math.max(0.15, clr.brightness * 0.15));
  } else {
    background(null);
  }

  strokewidth(0.1);
  nofill();
  autoclosepath(false);

  // ── Layer 1: dark, hue-varying strokes toward a focus point ─────────────
  let h = [random(1 - random(0.2)), random(0.2)];
  let v = [random(1 - random(0.2)), random(0.2)];
  let pts = makePoints(n, random(-d, d), random(-d, d), h, v);
  let fx = random(WIDTH);
  let fy = random(HEIGHT);
  let fvx = fx + random(-d / 2, d * 2);
  let fvy = fy + random(-d / 4, d / 4);
  let path = merge(pts, fx, fy, fvx, fvy, false, random(d / 2));

  let direction = choice([-1, 1]);
  for (let i = 0; i < Math.floor(iterations / 2); i++) {
    stroke(
      wrapAround(clr.hue + random(tonality) * direction),
      clr.saturation,
      clr.brightness * (0.4 + random(0.6)),
      random(0.25)
    );
    drawTransformed(path, 1.5, 0, angle, growth[0]);
  }

  // ── Layers 2–3: light, desaturated strokes from focus outward ───────────
  for (let j = 0; j < choice([2, 3]); j++) {
    reset();

    h = [random(1 - random(0.2)), random(0.2)];
    v = [random(1 - random(0.2)), random(0.2)];
    pts = makePoints(n, random(-d, d), random(-d, d), h, v);
    [fvx, fvy] = geo.reflect(fx, fy, fvx, fvy);
    path = merge(pts, fx, fy, fvx, fvy, true, 10);

    for (let i = 0; i < Math.floor(iterations / 2); i++) {
      stroke(
        clr.hue,
        clr.saturation + random(-0.6),
        random(0.2) + 0.8,
        random(0.25)
      );
      drawTransformed(path, random(), random(), angle, growth[1]);
    }
  }

  // ── Layer 4: light, hue-varying strokes that shrink ─────────────────────
  direction = choice([-1, 1]);
  for (let i = 0; i < iterations; i++) {
    stroke(
      wrapAround(clr.hue + random(tonality) * direction),
      clr.saturation + random(-0.2),
      random(0.2) + 0.8,
      random(0.25)
    );
    drawTransformed(path, 1.5, 0, angle, growth[2]);
  }

  reset();
}

// ── Main ─────────────────────────────────────────────────────────────────────
colormode(HSB);
size(700, 700);

// Amber-orange base (hue 0.1, low saturation, full brightness).
const clr = color(0.1, 0.3, 1);
nebula(clr);
