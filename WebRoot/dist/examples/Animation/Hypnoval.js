// Ported from the NodeBox 1 examples (MIT licence, © Frederik De Bleser).

// A simple animation example.
// The hypnotating ovals use a little bit of math to
// make smooth animations, notably sinus and cosinus functions.
// Animation scripts always contain:
//  - a setup function that is run once, at the start of the animation
//  - a draw function that is run for every frame.
// Variables shared between them are declared at the top level.

size(300, 300);

// Sets the frame rate of the animation.
speed(30);

let cnt;

// The setup function is called once, at the start of the animation.
// Here, it initializes the counter.
function setup() {
  cnt = 0.0;
}

// The draw function is called for every frame.
// Here, it draws the oval grid.
function draw() {
  // We use an internal counter that modifies each
  // oval slightly
  let s = 0.0;
  // Move the canvas a bit.
  translate(29, 40);
  // Draw a grid of 5 by 5.
  for (const [x, y] of grid(5, 5, 45, 42)) {
    // Oscillate the fill color.
    fill(0, 0, Math.sin(cnt + s * 5.0) / 2.0);
    // Draw the oval.
    oval(x + Math.sin(cnt + s) * 10.0, y + Math.cos(cnt + s) * -6.0, 41.0, 36.0);
    // Increase the counter so that every oval looks a bit different.
    s += 0.05;
  }
  // Increase the global counter.
  cnt += 0.19;
}
