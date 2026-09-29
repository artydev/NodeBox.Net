// Superfolia — translucent veined leaves, pink bubbles, cream blossoms and
// grey line tangles, all grown along one curved "spine" that sweeps from the
// bottom-right corner up to the top-left.
// Plain script → rendered once. Re-run for a new bouquet.

// ── Work in a 560×650 space (the original's portrait), fitted to the window ──
const W = 560, H = 650;
const S  = Math.min(WIDTH / W, HEIGHT / H);
const OX = (WIDTH  - W * S) / 2;
const OY = (HEIGHT - H * S) / 2;
const RAD = Math.PI / 180;

// ── Helpers ──
const gauss = () => (random() + random() + random() - 1.5) / 1.5;   // ≈ −1…1, bell-shaped
const lerp  = (a, b, t) => a + (b - a) * t;

// The spine: a cubic Bézier from bottom-right (t = 0) to top-left (t = 1).
const SP = [[560, 690], [520, 420], [420, 180], [170, 60]];
function spine(t) {
  const u = 1 - t;
  const b = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [b.reduce((s, k, i) => s + k * SP[i][0], 0), b.reduce((s, k, i) => s + k * SP[i][1], 0)];
}
// A point near the spine: `spread` sideways, more generous toward the bottom.
function around(t, spread) {
  const [x, y] = spine(t);
  const w = spread * (1.25 - 0.6 * t);
  return [x + gauss() * w, y + gauss() * w * 0.8];
}

// ── Palette (HSB for leaves: hue ≈ magenta, varied) ──
const CREAM = color('#fffbe0');
const GREY  = color(0.25, 0.25, 0.25, 0.33);
const STEM  = color('#d9e06e');

colormode(HSB);
const leafDeep  = () => color(random(0.92, 0.975), random(0.8, 0.95), random(0.78, 0.92), 0.85);
const leafWarm  = () => color(random(0.98, 1.03),  random(0.35, 0.5),  0.97, 0.75);
const leafPale  = () => color(random(0.12, 0.17),  random(0.35, 0.5),  0.95, 0.7);
const bubbleClr = () => color(random(0.9, 0.97),   random(0.25, 0.75), random(0.85, 1), random(0.35, 0.8));
colormode(RGB);

transform(CORNER);                 // transforms pivot on the origin (layout scaling)
push();
translate(OX, OY);
scale(S);
background(1);

// ── Grey line tangles: loose looping curves (one path) ──
function tangles(count, reach) {
  const p = new BezierPath();
  for (let i = 0; i < count; i++) {
    const t = random(0, 1);
    const [x, y] = around(t, 120);
    const a = random(90, 270) * RAD;                     // mostly leftward
    const l = random(40, reach);
    const ex = x + Math.cos(a) * l, ey = y - Math.abs(Math.sin(a)) * l * 0.6;
    p.moveto(x, y);
    p.curveto(x + random(-80, 80), y + random(-80, 80),
              ex + random(-90, 90), ey + random(-90, 90), ex, ey);
  }
  nofill();
  stroke(GREY);
  strokewidth(0.4);
  drawpath(p);
}

// ── A leaf: pointed lens along +x, gradient deep → warm → pale, with veins ──
function leaf(x, y, angle, len, wid) {
  push();
  translate(x, y);
  rotate(angle);                                         // NodeBox: counter-clockwise
  const bend = random(-0.25, 0.25) * wid;                // slight curl
  const body = new BezierPath()
    .moveto(0, 0)
    .curveto(len * 0.3, -wid + bend, len * 0.72, -wid * 0.55 + bend, len, bend * 0.5)
    .curveto(len * 0.72, wid * 0.55 + bend, len * 0.3, wid + bend, 0, 0)
    .closepath();
  nostroke();
  fill(lineargradient(0, 0, len, 0, [[0, leafDeep()], [0.55, leafWarm()], [1, leafPale()]]));
  drawpath(body);

  // Veins: a midrib and paired side veins sweeping toward the tip.
  const veins = new BezierPath().moveto(0, 0).curveto(len * 0.4, bend * 0.6, len * 0.7, bend * 0.8, len * 0.97, bend * 0.5);
  const n = Math.round(len / 9);
  for (let k = 1; k < n; k++) {
    const t = k / n, vx = t * len * 0.92, vy = bend * t;
    const reach = wid * 0.8 * Math.sin(Math.PI * Math.min(1, t * 1.1));
    for (const side of [-1, 1]) {
      veins.moveto(vx, vy).curveto(vx + reach * 0.4, vy + side * reach * 0.4,
                                   vx + reach * 0.8, vy + side * reach * 0.75,
                                   vx + reach, vy + side * reach * 0.85);
    }
  }
  nofill();
  stroke(0.55, 0.05, 0.3, 0.28);
  strokewidth(0.35);
  drawpath(veins);
  pop();
}

function leaves(count, t0, t1) {
  for (let i = 0; i < count; i++) {
    const t = random(t0, t1);
    const [x, y] = around(t, 150);
    const len = random(45, 125) * (1.1 - 0.35 * t);
    leaf(x, y, random(115, 215), len, len * random(0.16, 0.3));   // pointing left / up-left
  }
}

// ── Bubbles: pink dots and rings, denser toward the top ──
function bubbles(count) {
  for (let i = 0; i < count; i++) {
    const t = Math.pow(random(), 0.7);
    const [x, y] = around(t, 170);
    const r = Math.pow(random(), 2.2) * 9 + 0.8;
    if (random() < 0.8) { nostroke(); fill(bubbleClr()); }
    else                { nofill(); stroke(bubbleClr()); strokewidth(0.5); }
    oval(x - r, y - r, r * 2, r * 2);
  }
}

// ── Cream blossoms: cauliflower-like clusters of overlapping discs + dark specks ──
function blossom(cx, cy, size) {
  nostroke();
  fill(CREAM);
  const n = Math.round(size * 1.1);
  for (let i = 0; i < n; i++) {
    const a = random(360) * RAD, d = Math.sqrt(random()) * size;
    const r = random(2, 9) * (1 - 0.5 * d / size);
    oval(cx + Math.cos(a) * d - r, cy + Math.sin(a) * d - r, r * 2, r * 2);
  }
  fill(0.3, 0.28, 0.25, 0.7);                            // specks among the florets
  for (let i = 0; i < n / 3; i++) {
    const a = random(360) * RAD, d = random(0.4, 1.15) * size, r = random(0.4, 1.4);
    oval(cx + Math.cos(a) * d - r, cy + Math.sin(a) * d - r, r * 2, r * 2);
  }
}

// ── Stems: a few long yellow-green strokes following the spine ──
function stems(count) {
  const p = new BezierPath();
  for (let i = 0; i < count; i++) {
    const [x0, y0] = around(random(0, 0.3), 90);
    const [x1, y1] = around(random(0.4, 0.8), 110);
    p.moveto(x0, y0).curveto(lerp(x0, x1, 0.3) + random(-60, 60), lerp(y0, y1, 0.3),
                             lerp(x0, x1, 0.7) + random(-60, 60), lerp(y0, y1, 0.7), x1, y1);
  }
  nofill();
  stroke(STEM.withAlpha(0.8));
  strokewidth(1.1);
  drawpath(p);
}

// ── Compose, back to front ──
tangles(220, 260);                   // grey haze behind everything
stems(10);
leaves(70, 0.15, 1.0);               // back leaves
bubbles(380);
for (let i = 0; i < 9; i++) {        // blossoms, mostly lower-right
  const [x, y] = around(random(0.02, 0.6), 110);
  blossom(x, y, random(22, 52));
}
leaves(45, 0.2, 0.95);               // front leaves overlap blossoms
tangles(90, 180);                    // a few lines on top
bubbles(220);                        // fine bubbles on top

pop();
