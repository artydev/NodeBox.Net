// Ported from the NodeBox 1 examples (MIT licence, © Frederik De Bleser).

// Randomly fill a grid with ovals and rectangles.

size(600, 600);

for (const [x, y] of grid(30, 30, 20, 20)) {
  if (random() > 0.6) {
    // Here, we choose between two functions: oval and rect.
    // The chosen function is stored in the 'form' variable, which
    // is then called on the next line. Note that both functions
    // should have the same parameters, and in the same order.
    const form = choice([oval, rect]);
    form(x, y, 18, 18);
  }
}
