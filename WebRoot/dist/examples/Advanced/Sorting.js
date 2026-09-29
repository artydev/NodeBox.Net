// Ported from the NodeBox 1 examples (MIT licence, © Frederik De Bleser).

// Sorting shapes by position.
//
// The original edits shapes that are already on NodeBox's canvas: it reads
// them back, sorts them by vertical position, then scales and re-strokes
// each one. NodeBox for Windows draws immediately, so this port keeps its
// own list of shapes, sorts it, and only then draws — same result.

size(550, 300);

fill(1, 0.8);
strokewidth(1.5);

// First, generate some rectangles all over the canvas, rotated randomly.
const shapes = [];
for (let i = 0; i < 3000; i++) {
  shapes.push({ x: randint(WIDTH) - 25, y: randint(HEIGHT) - 25, angle: randint(360) });
}

// Now comes the smart part:
// We sort the shapes using a custom sorting function;
// in this case, their vertical position.
shapes.sort((a, b) => a.y - b.y);

// t is a counter going from 0.0 to 1.0
let t = 0.0;
// d is the delta amount added each step
const d = 1.0 / shapes.length;

// Traverse them in order: shapes get bigger and their stroke gets darker.
// Drawing in sorted order also sets the Z-ordering (lower shapes on top).
for (const s of shapes) {
  push();
  rotate(s.angle);
  scale(t);
  stroke(0.6 - t, 0.5);
  rect(s.x, s.y, 50, 50);
  pop();
  t += d;
}
