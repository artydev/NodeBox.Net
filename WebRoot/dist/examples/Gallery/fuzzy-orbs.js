// Fuzzy orbs — marbled, furry spheres trailing long tendrils.
// The marbling is a procedural kaleidoscope (no image() needed):
// random motifs in one 30° wedge, mirrored and repeated 6× around the centre.
// Plain script → rendered once. Re-run for new textures, fur and tendrils.

// ── Work in a 700×700 space, fitted to the window ──
const S  = Math.min(WIDTH, HEIGHT) / 700;
const OX = (WIDTH  - 700 * S) / 2;
const OY = (HEIGHT - 700 * S) / 2;
const RAD = Math.PI / 180;

// ── Palette: parchment, umber, soot ──
const LIGHT  = color('#eadcc0');
const TAN    = color('#b89c74');
const UMBER  = color('#5b3d24');
const SOOT   = color('#1c140d');
const MOTIFS = ['#2e1f14', '#5a3b22', '#8b6b45', '#c9b08a', '#efe3cb'].map((h) => color(h));

// Orbs as (x, y, radius), roughly the original composition; drawn top → bottom,
// so lower (closer) orbs overlap the ones above.
const ORBS = [
  [185, 150, 78], [265, 222, 75], [135, 248, 22], [660, 185, 55], [600, 315, 22],
  [375, 330, 62], [190, 350, 60], [412, 388, 58], [540, 395, 45], [650, 455, 62],
  [160, 490, 35], [278, 497, 15], [385, 515, 82], [350, 632, 85],
].sort((a, b) => a[1] - b[1]);

transform(CORNER);                 // transforms pivot on the origin (layout scaling)
push();
translate(OX, OY);
scale(S);

// ── Background: dark umber sky fading to pale stone ──
background(lineargradient(0, 0, 0, 700, [
  [0,   color('#2b221c')],
  [0.5, color('#6f655c')],
  [1,   color('#cbc3ba')],
]));

// ── Tendrils: long sweeping hairs trailing down-right, behind everything ──
const tendrils = new BezierPath();
for (const [x, y, r] of ORBS) {
  const count = Math.round(r * 0.6);
  for (let i = 0; i < count; i++) {
    const a  = random(10, 130) * RAD;                     // leave from the lower side
    const sx = x + Math.cos(a) * r * 0.9, sy = y + Math.sin(a) * r * 0.9;
    const ex = sx + random(40, 480),       ey = sy + random(120, 620);
    tendrils.moveto(sx, sy);
    tendrils.curveto(sx + random(-60, 90),   sy + random(60, 220),
                     ex + random(-260, -20), ey + random(-240, -40),
                     ex, ey);
  }
}
nofill();
stroke(0.2, 0.16, 0.12, 0.28);
strokewidth(0.45);
drawpath(tendrils);

// ── Helpers ──

// Fur: short strands radiating from the rim, slightly curved. One path per call.
function fur(x, y, r, count, from, to, len0, len1) {
  const p = new BezierPath();
  for (let i = 0; i < count; i++) {
    const a  = random(360) * RAD;
    const r0 = r * random(from, to);
    const l  = r * random(len0, len1);
    const sx = x + Math.cos(a) * r0,       sy = y + Math.sin(a) * r0;
    const ex = x + Math.cos(a) * (r0 + l), ey = y + Math.sin(a) * (r0 + l);
    const bend = random(-0.25, 0.25) * l;                 // sideways kink
    const mx = (sx + ex) / 2 - Math.sin(a) * bend, my = (sy + ey) / 2 + Math.cos(a) * bend;
    p.moveto(sx, sy);
    p.curveto(mx, my, mx, my, ex, ey);
  }
  return p;
}

// One kaleidoscope motif (triangle, lens or dot) as a path in local coordinates.
function motif(kind, size) {
  const p = new BezierPath();
  if (kind === 0) {                                       // triangle
    p.moveto(0, -size); p.lineto(size * 0.87, size * 0.5); p.lineto(-size * 0.87, size * 0.5); p.closepath();
  } else if (kind === 1) {                                // lens / petal
    p.moveto(-size, 0);
    p.curveto(-size * 0.4, -size * 0.8, size * 0.4, -size * 0.8, size, 0);
    p.curveto(size * 0.4, size * 0.8, -size * 0.4, size * 0.8, -size, 0);
    p.closepath();
  } else {                                                // blob
    const k = 0.55 * size;
    p.moveto(size, 0);
    p.curveto(size, k, k, size, 0, size);    p.curveto(-k, size, -size, k, -size, 0);
    p.curveto(-size, -k, -k, -size, 0, -size); p.curveto(k, -size, size, -k, size, 0);
    p.closepath();
  }
  return p;
}

// Kaleidoscope marbling: motifs placed in one wedge, then reflected and rotated
// 6× (12 copies). Everything stays within 0.86 r, so no clipping is needed.
function marble(x, y, r) {
  nostroke();
  const n = Math.round(10 + r * 0.22);
  for (let i = 0; i < n; i++) {
    const size = r * random(0.04, 0.16);
    const rho  = random(0.08, 0.86) * r - size;
    if (rho < 0) continue;
    const theta = random(0, 30);                         // inside the wedge
    const kind  = Math.floor(random(3));
    const spin  = random(360);
    const clr   = choice(MOTIFS).withAlpha(random(0.35, 0.8));
    const shape = motif(kind, size);
    fill(clr);
    for (let j = 0; j < 6; j++) {
      for (const mirror of [1, -1]) {                     // reflection = kaleidoscope
        push();
        translate(x, y);
        rotate(j * 60 + mirror * theta);
        translate(rho, 0);
        rotate(mirror * spin);
        scale(1, mirror);
        drawpath(shape);
        pop();
      }
    }
  }
}

// ── Orbs ──
for (const [x, y, r] of ORBS) {
  // Fur behind the body: dark, dense, longest at the rim.
  noshadow();
  nofill();
  stroke(SOOT.withAlpha(0.55));
  strokewidth(0.5);
  drawpath(fur(x, y, r, Math.round(r * 11), 0.82, 1.0, 0.08, 0.34));

  // Body: warm radial gradient, lit from the upper-left, soft drop shadow.
  shadow('black', r * 0.35 * S, 0, r * 0.18 * S, 0.35);
  nostroke();
  fill(radialgradient(x - r * 0.3, y - r * 0.35, r * 1.35, [
    [0,    LIGHT],
    [0.45, TAN],
    [1,    UMBER],
  ]));
  oval(x - r, y - r, r * 2, r * 2);
  noshadow();

  // Marbled kaleidoscope texture.
  marble(x, y, r);

  // Shading over the texture: glossy highlight → transparent → dark rim.
  fill(radialgradient(x - r * 0.3, y - r * 0.35, r * 1.4, [
    [0,    color(1, 0.97, 0.9, 0.35)],
    [0.35, color(1, 1, 1, 0)],
    [0.75, color(0.08, 0.05, 0.03, 0.35)],
    [1,    color(0.05, 0.03, 0.02, 0.9)],
  ]));
  oval(x - r, y - r, r * 2, r * 2);

  // Fur in front of the rim: breaks up the silhouette.
  nofill();
  stroke(SOOT.withAlpha(0.6));
  strokewidth(0.45);
  drawpath(fur(x, y, r, Math.round(r * 5), 0.9, 0.99, 0.05, 0.22));
}

pop();
