// Ported from the NodeBox 1 examples (MIT licence, © Frederik De Bleser).

// Draw a grid of grids.

size(500, 500);

// Use corner transformations to rotate objects from the top-left corner,
// instead of from the center of an object (which is the default).
transform(CORNER);

font('Gill Sans', 72);

for (let i = 0; i < 600; i++) {
  // At the beginning of the loop, push the current transformation.
  // This means that each loop begins with a "clean slate".
  push();
  // Fills aren't remembered using push/pop, only transformations.
  fill(random(), 0, 0, 0.5);
  // Use this way of translation to put objects on a grid.
  // NodeBox also has a grid function: see the examples in Grid.
  translate(randint(1, 10) * 50, randint(1, 10) * 50);
  rotate(randint(360));
  scale(random(1.8));
  // Change this text for other interesting results.
  text('#', 0, 0);
  pop();
}
