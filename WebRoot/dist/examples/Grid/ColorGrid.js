// Ported from the NodeBox 1 examples (MIT licence, © Frederik De Bleser).

// Create a color Grid.
// This example also shows off the HSB color mode that allows
// you to select colors more naturally, by specifying a hue,
// saturation and brightness.

size(625, 625);

colormode(HSB);

// Set some initial values. You can and should play around with these.
let h = 0;
let s = 0.5;
const b = 0.9;
const a = 0.5;

// sz is the size of one grid square. (The Python original called it
// `size`, which in JavaScript would hide the size() function.)
const sz = 50;

// Using the translate command, we can give the grid some margin.
translate(50, 50);

// Create a grid with 10 rows and 10 columns. The width of the columns
// and the height of the rows is defined in the 'sz' variable.
for (const [x, y] of grid(10, 10, sz, sz)) {
  // Increase the hue while choosing a random saturation.
  // Try experimenting here, like decreasing the brightness while
  // changing the alpha value etc.
  h += 0.01;
  s = random();

  // Set this to be the current fill color.
  fill(h, s, b, a);

  // Draw a rectangle that is one and a half times larger than the
  // grid size to get an overlap.
  rect(x, y, sz * 1.5, sz * 1.5);
}
