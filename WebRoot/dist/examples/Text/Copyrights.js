// Ported from the NodeBox 1 examples (MIT licence, © Frederik De Bleser).

// Small example demonstrating how to display unicode text.

size(600, 600);

const white = color(1, 1, 1, 0.9);
const red = color(1, 0, 0, 0.9);
const black = color(0, 0, 0, 0.9);

for (let i = 0; i < 20; i++) {
  // Choose a color from the list.
  fill(choice([white, red, black]));
  font('Arial Bold');
  fontsize(randint(600));

  // The TradeMark, Registered and Copyright signs are
  // Unicode characters. JavaScript strings are Unicode already.
  text('™', randint(500), randint(400));
  text('®', randint(500), randint(400));
  text('©', randint(500), randint(400));
}
