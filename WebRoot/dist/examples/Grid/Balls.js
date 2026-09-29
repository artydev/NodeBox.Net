// Ported from the NodeBox 1 examples (MIT licence, © Frederik De Bleser).

// Use a grid to generate a bubble-like composition.
// This example shows that a grid doesn't have to be rigid at all.
// It's very easy to break loose from the coordinates NodeBox
// passes you, as is shown here. The trick is to add or subtract
// something from the x and y values NodeBox passes on. Here,
// we also use random sizes.

size(600, 600);

const gridSize = 40;
// Translate a bit to the right and a bit to the bottom to
// create a margin.
translate(100, 100);

const startval = random();
let c = random();
for (const [x, y] of grid(10, 10, gridSize, gridSize)) {
  fill(Math.sin(startval + y * x / 100.0), Math.cos(c), Math.cos(c), random());
  const s = random() * gridSize;
  oval(x, y, s, s);
  fill(Math.cos(startval + y * x / 100.0), Math.cos(c), Math.cos(c), random());
  const deltaX = (random() - 0.5) * 10;
  const deltaY = (random() - 0.5) * 10;
  const deltaS = (random() - 0.5) * 200;
  oval(x + deltaX, y + deltaY, deltaS, deltaS);
  c += 0.01;
}
