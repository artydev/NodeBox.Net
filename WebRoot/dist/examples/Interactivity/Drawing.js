// Ported from the NodeBox 1 examples (MIT licence, © Frederik De Bleser).

// This example allows you to draw lines on screen.
// It also transforms the line while you're drawing it.
// Move the mouse over the canvas.

// Each time you move the mouse, a new point is stored in a list of points.
// The draw function first transforms this list (to get a mutated line),
// then draws the points in this list. We use findpath to find a path
// "through" the list of points.

size(500, 500);
speed(30);

// px/py are the previous mouse coordinates.
let px, py;
// pointlist is the list of points we created by moving the mouse.
let pointlist;

function setup() {
  px = 0;
  py = 0;
  pointlist = [];
}

function draw() {
  // For each frame, set the background color to a darkish blue.
  background(0.0, 0.0, 0.2);

  // Only draw a new point if the mouse has moved, which means the current mouse
  // position is different from the previous one.
  // You can add "&& mousedown" to the if statement to only draw points when
  // you hold down the mouse button. If you do, try clicking to get lines.
  if (MOUSEX !== px && MOUSEY !== py) {
    pointlist.push(Point(MOUSEX, MOUSEY));
    px = MOUSEX;
    py = MOUSEY;
  }

  // Set the correct color, a light blue.
  nofill();
  stroke(0.9, 0.9, 1.0);
  strokewidth(2);

  // This function actually transforms the points. We replace our current list of points
  // by the transformed version.
  // If you comment this line out, points won't be transformed, and you get a regular
  // line drawing program, but where's the fun in that?
  pointlist = transform_list(pointlist);

  // If there are points in the list...
  if (pointlist.length > 0) {
    // ...draw them. We use the findpath function to find a path
    // that goes through the list of points. The curvature defines
    // whether the path is rounded (1.0) or straight (0.0).
    drawpath(findpath(pointlist, 1.0));
  }
}

// This is the transformation function that gets applied to all points in the path.
// It returns either a new point, or null if the point needs to be deleted.
// Currently, it applies some sinus/cosinus functions to the point to make them curl
// and move offscreen.
function transform_point(pt, index, total_length) {
  // Add something to the x and y coordinates.
  // The formula (total_length - index), makes the influence on "older"
  // points (in the beginning of the list, with a low index) greater.
  pt.x += Math.sin(index / 50.0) * (total_length - index) / 100.0;
  pt.y -= Math.cos(index / 100.0) * (total_length - index) / 100.0;
  // If the point is offscreen, return null to indicate that we want the point deleted.
  if (pt.x < 0 || pt.x > WIDTH || pt.y < 0 || pt.y > HEIGHT) return null;
  return pt;
}

// This function transforms a list of points, and returns a new list.
// You can specify the function that will be used to transform each point.
// You can copy/paste the transform_point function and try to make a new one yourself.
function transform_list(pointlist, fn = transform_point) {
  const total_length = pointlist.length;
  // We make a new list because we are going to be deleting elements from the old list.
  const newlist = [];
  pointlist.forEach((pt, i) => {
    // For each point, "apply" the function to get a new point.
    const newpoint = fn(pt, i, total_length);
    // If the transformation function returns null, the point is dropped.
    if (newpoint !== null) newlist.push(newpoint);
  });
  return newlist;
}
