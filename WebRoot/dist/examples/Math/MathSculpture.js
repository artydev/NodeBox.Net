// Ported from the NodeBox 1 examples (MIT licence, © Frederik De Bleser).

// Generates sculptures using a set of mathematical functions.
// Every iteration adds a certain value to the current coordinates.
// Rewriting this program to use transforms is left as an exercise
// for the reader.

size(400, 800);

background(0);

let cX = randint(1, 10);
let cY = randint(1, 10);

let x = 200;
let y = 54;
fontsize(10);
for (let i = 0; i < 278; i++) {
  x += Math.cos(cY) * 10;
  y += Math.log10(cX) * 1.85 + Math.sin(cX) * 5;

  fill(random() - 0.4, 0.8, 0.8, random());

  const s = 10 + Math.cos(cX) * 15;
  oval(x - s / 2, y - s / 2, s, s);
  // Try the next line instead of the previous one to see how
  // you can use other primitives.
  // star(x - s / 2, y - s / 2, randint(5, 10), 10 + s * 0.1, 2 + s * 0.1);

  cX += random(0.25);
  cY += random(0.25);
}
