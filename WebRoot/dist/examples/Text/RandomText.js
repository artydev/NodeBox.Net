// Ported from the NodeBox 1 examples (MIT licence, © Frederik De Bleser).

// Generate compositions using random text.

size(800, 600);

font('Arial Black');

// Returns a random string of up to 9 characters.
function rndText() {
  let t = '';
  const n = randint(10);
  for (let i = 0; i < n; i++) t += String.fromCharCode(randint(10, 120));
  return t;
}

// Define some colors.
// (In HSB mode, "white" (1, 1, 1) is actually a bright red — as in the original.)
colormode(HSB);
const white = color(1, 1, 1, 0.8);
const black = color(0, 0, 0, 0.8);
const red = color(random(), 0, 0.2, 0.8);

translate(0, -200);
for (let i = 0; i < 100; i++) {
  // This translation is not reset every time, so it is
  // appended to previous translations. This gives
  // interesting effects.
  translate(randint(-100, 100), randint(-100, 100));
  // Save the current transformation. It's a good idea
  // to do this in the beginning of a loop. End the
  // loop with a pop.
  push();
  // Rotate in increments of 45 degrees.
  rotate(randint(5) * 45);
  fontsize(randint(800));
  fill(choice([white, black, red]));
  const someText = rndText();
  text(someText, 0, 0);
  pop();
}
