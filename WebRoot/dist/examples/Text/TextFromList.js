// Ported from the NodeBox 1 examples (MIT licence, © Frederik De Bleser).

// Generate compositions using predefined words.

size(800, 600);

const txt = ['DIE', 'BUY', 'WHY', 'NOW', '!'];

font('Arial Black');

// Define some colors.
const white = color(1, 1, 1);
const black = color(0, 0, 0);
const red = color(1, 0, 0);

translate(0, -200);
for (let i = 0; i < 100; i++) {
  // The next line isn't inside of the push-pops and therefore
  // the translate is appended every time. This might mean that
  // the composition goes off-screen. This also means that
  // it creates more interesting compositions.
  translate(randint(-100, 100), randint(-100, 100));
  // Save the current transformation. It's a good idea
  // to do this in the beginning of a loop. End the
  // loop with a pop.
  push();
  // Rotate in increments of 45 degrees.
  rotate(randint(5) * 45);
  fontsize(randint(800));
  fill(choice([white, black, red]));
  let someText = choice(txt);
  // One in two times, change the text to lowercase.
  if (randint(2) === 1) someText = someText.toLowerCase();
  text(someText, 0, 0);
  pop();
}
