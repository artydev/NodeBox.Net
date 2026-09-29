// Ported from the NodeBox 1 examples (MIT licence, © Frederik De Bleser).

// Cover generator

size(400, 300);

// The HSB color mode is the big trick here. We use it to generate
// a random hue with a fixed brightness and saturation. That way,
// we can use all kinds of different colors that automatically fit
// together.
colormode(HSB);

// Set a random background color
fill(random(), 0.5, 0.5);
rect(0, 0, WIDTH, HEIGHT);

// Draw 10 rectangles on top of each other, each with a different color,
// and a random starting position and height.
for (let i = 0; i < 10; i++) {
  fill(random(), 0.5, 0.5);
  rect(0, randint(-200, HEIGHT + 200), WIDTH, randint(-200, HEIGHT + 200));
}

// Draw the text.
fill(1, 0, 1);
scale(8);
text('*', WIDTH - 50, 50);
reset();
text('NODEBOX', 10, HEIGHT - 30);
fontsize(13.5);
fill(1, 0, 1, 0.4);
text('AUTUMN | WINTER 2007', 10, HEIGHT - 18);
