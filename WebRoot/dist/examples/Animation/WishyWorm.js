// Ported from the NodeBox 1 examples (MIT licence, © Frederik De Bleser).

// Generates sculptures using a set of mathematical functions.
// Every iteration adds a certain value to the current coordinates.
// Rewriting this program to use transforms is left as an exercise
// for the reader.

size(400, 400);
speed(100);

let a, b;

function setup() {
  a = 10.0;
  b = 0.0;
}

function draw() {
  seed(0);

  background(0, 0, 0.15);
  let cX = a;
  let cY = b;

  let x = 180;
  let y = -27;
  fontsize(54);
  let c = 0.0;
  for (let i = 0; i < 48; i++) {
    x += Math.cos(cY) * 5;
    y += Math.log10(cX) * 8.36 + Math.sin(cX) * 2;

    fill(Math.sin(a + c), 0.3, 0.0, 0.5);

    const s = 22 + Math.cos(cX) * 17;
    oval(x - s / 2, y - s / 2, s, s);
    // Try the next line instead of the previous one to see how
    // you can use other primitives.
    // star(x - s / 2, y - s / 2, randint(5, 10), 10 + s * 0.1, 2 + s * 0.1);

    cX += random(0.25);
    cY += random(0.25);
    c += 0.1;
  }
  a += 0.1;
  b += 0.05;
}
