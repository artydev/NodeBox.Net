// Ported from the NodeBox 1 examples (MIT licence, © Frederik De Bleser).

// Play around with elementary math functions.
// Here, we are creating some sort of tunnel effect by
// using sinus and cosinus functions.

size(1000, 1000);

const startval = random();
stroke(0.2);
let c = random();
for (let i = 0; i < 300; i++) {
  const delta = (random() - 0.5) * 0.1;
  const x = 400 + Math.sin(c + delta) * (i + randint(-10, 10));
  const y = 400 + Math.cos(c + delta) * (i + randint(-10, 10));
  const s = random(c * 2);

  fill(random() - 0.4, 0.2, 0.2, random());

  // We choose here between two functions, the oval
  // and rect function. After we put the desired function
  // in the primitive variable, we execute that function with
  // the given parameters. Note that the parameters of
  // the two functions should match for this to work.
  const primitive = choice([oval, rect]);
  primitive(x - s / 2, y - s / 2, s, s);

  c += random() * 0.25;
}
