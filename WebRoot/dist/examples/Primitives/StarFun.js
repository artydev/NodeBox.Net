// Ported from the NodeBox 1 examples (MIT licence, © Frederik De Bleser).

// Fun with stars!

size(600, 600);

// Use the HSB color model to generate matching random colors.
colormode(HSB);

// This loop has no push and pop, meaning that every transformation
// is appended to the previous ones.
for (let y = 0; y < 100; y++) {
  fill(random(0.8, 1), random(), random(0.2, 0.6), random());
  rotate(randint(-3, 3));
  translate(randint(-100, 100), randint(-100, 100));
  star(300, 300, randint(1, 100), randint(1, 5), randint(1, 500));
}
