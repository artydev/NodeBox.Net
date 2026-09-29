// Ported from the NodeBox 1 examples (MIT licence, © Frederik De Bleser).

// A foliage generator!
// The foliage are actually green stars with random
// inner and outer radii and a random number of points.
// They are skewed to make it look more random.

size(700, 700);

translate(50, 50);
// By using HSB colormode, we can change the saturation and brightness
// of the leaves to get more natural color variations.
colormode(HSB);

// Generate a 50 x 50 grid. Each row and column is 12 points wide.
for (const [x, y] of grid(50, 50, 12, 12)) {
  push();
  fill(0.3, random(), random(0.2, 0.6), 0.8);
  skew(randint(-50, 50));
  star(x + randint(-5, 5), y + randint(-5, 5), randint(10), randint(1, 40), 15);
  pop();
}
