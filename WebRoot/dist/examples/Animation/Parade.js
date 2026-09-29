// Ported from the NodeBox 1 examples (MIT licence, © Frederik De Bleser).

// The parade!
//
// This example shows object-oriented design in animation for
// defining a set of "actors" (the balls) that parade on stage.

speed(30);
size(400, 646);

// Define our own circle function (NodeBox doesn't have one)
// that draws from the center.
function circle(x, y, sz) {
  oval(x - sz / 2, y - sz / 2, sz, sz);
}

// The main actor in the animation is a Ball.
// A Ball has a set of state values: its position, size, color and delta-values.
// The delta-values affect the position and size, and are a simple way to give
// each ball "character". Higher delta-values make the ball more hectic.
class Ball {
  // Initialize a ball -- set all the values to their defaults.
  constructor() {
    this.x = randint(WIDTH);
    this.y = randint(HEIGHT);
    this.size = randint(10, 72);
    this.dx = this.dy = this.ds = 0.0;
    this.color = color(random(), 1, randint(0, 2), random());
  }

  // Update the internal state values.
  update() {
    this.dx = Math.sin(FRAME / randint(1, 100)) * 20.0;
    this.dy = Math.cos(FRAME / randint(1, 100)) * 20.0;
    this.ds = Math.cos(FRAME / randint(1, 123)) * 10.0;
  }

  // Draw a ball: set the fill color first and draw a circle.
  draw() {
    fill(this.color);
    circle(this.x + this.dx, this.y + this.dy, this.size + this.ds);
  }
}

let balls;

// Initialize the animation by instantiating a list of balls.
function setup() {
  balls = [];
  for (let i = 0; i < 30; i++) balls.push(new Ball());
}

// Draw the animation by updating and drawing each individual ball.
function draw() {
  // The same seed every frame: each ball gets the same "random" deltas.
  seed(1);
  // This translate command makes the ball move up on the screen.
  translate(0, HEIGHT - FRAME);
  for (const ball of balls) {
    ball.update();
    ball.draw();
  }
}
