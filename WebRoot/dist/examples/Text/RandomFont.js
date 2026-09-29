// Ported from the NodeBox 1 examples (MIT licence, © Frederik De Bleser).

// Demonstrate how to randomly select a font from a list.
// In addition, it also demonstrates how to use a live variable
// to set the text size: drag the "textsize" slider over the canvas.
// (NodeBox's var() is called variable() here — `var` is reserved in JavaScript.)

size(400, 400);
variable('textsize', NUMBER, 50.0, 0.0, 100.0);

const names = ['Helvetica', 'Arial', 'Times', 'Impact', 'Verdana'];

fill(1, 0, 0);

// Select a font randomly from the list of names.
font(choice(names));

// textsize is the live variable defined above.
fontsize(textsize);

// Display the text. Because the coordinates start from
// the baseline, you have to add the size of the font to
// the y coordinate so it doesn't fall off the page.
text('Hi there!', 12, textsize);
