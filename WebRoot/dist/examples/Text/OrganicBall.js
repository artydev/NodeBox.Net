// Ported from the NodeBox 1 examples (MIT licence, © Frederik De Bleser).

// Create organic balls using text.
// (Zapfino is a Mac font; on Windows it maps to the calligraphic Gabriola.)

size(600, 600);

font('Zapfino');
fontsize(72);

// Draw a black background.
background(0);

// Move to the center of the composition. Note that, because
// we use a calligraphic font, the ball will end up off-center.
translate(WIDTH / 2, HEIGHT / 2);
for (let i = 0; i < 100; i++) {
  // The trick is skewing, rotating and scaling without
  // moving so all elements share the same centerpoint.
  push();
  // Select a value between (0,0,0) (black) and (1,0,0) (red).
  fill(random(), 0, 0);
  rotate(randint(0, 800));
  scale(random() * 2);
  skew(randint(200));
  text('(', 0, 0);
  pop();
}
