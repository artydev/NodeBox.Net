// Ported from the NodeBox 1 examples (MIT licence, © Frederik De Bleser).

// BitBop -- a fun demonstration of path.contains.
//
// The textpath command returns a BezierPath of the text that can
// be manipulated or, as demonstrated here, queried using path.contains.
// A grid is generated and everywhere a point in the path is encountered,
// a random square is drawn.

size(535, 140);

background(0.8, 0.7, 0);
fill(0.1, 0.1, 0.2);

// Set the font and create the text path.
font('Verdana', 100);
align(CENTER);
const tp = textpath('NodeBox', 0, 100, WIDTH);
// tp.draw(); // Draws the underlying path

// Here are the variables that influence the composition:
const resx = 100;    // The horizontal resolution
const resy = 100;    // The vertical resolution
const rx = 5.0;      // The horizontal randomness each point has
const ry = 5.0;      // The vertical randomness each point has
const dotsize = 6.0; // The maximum size of one dot.
const dx = WIDTH / resx;  // The width each dot covers
const dy = HEIGHT / resy; // The height each dot covers

// We create a grid of the specified resolution.
// Each x,y coordinate is a measuring point where
// we check if it falls within the path.
for (const [x, y] of grid(resx, resy)) {
  const sz = random(dotsize);
  // Create the point that will be checked
  const px = x * dx - sz;
  const py = y * dy - sz;
  // Only do something if the point falls within the path bounds.
  // You could add an "else" statement, that draws something in the
  // empty positions.
  if (tp.contains(px, py)) {
    // Change the color for each point -- try it out!
    // fill(0, 0, random(), random());
    oval(px + random(-rx, rx), py + random(-ry, ry), sz, sz);
  }
}
