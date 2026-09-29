// Ported from the NodeBox 1 examples (MIT licence, © Frederik De Bleser).

// Avoider: the first NodeBox game!
// The purpose of the game is pretty simple:
// try to avoid the red blobs for as long as possible.
// Click the canvas first, then use the arrow keys.

// This example is a bit longer than the others, and features some geometry,
// object-oriented programming, and interactivity.

// You can change the size of the canvas to get a bigger or smaller playing field.
size(300, 324);
speed(30);

// The height of the bar at the bottom displaying the current time.
const STATUS_BAR_HEIGHT = 12;

// angle(), coordinates() and distance() are NodeBox's geometry helpers.

// The hero of the game.
class Hero {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.speed = 5.0;
    this.size = 5.0;
  }

  draw() {
    fill(0, 0, 0);
    oval(this.x - this.size, this.y - this.size, this.size * 2, this.size * 2);
  }
}

// The bad guys in the game. Avoid them!
// These are non-player characters, meaning they aren't controlled by the player directly.
// The update method contains their "brain".
class Blob {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.size = 5.0;
    this.speed = random(0.5, 0.8);
    this.seed = random();
    this.angle = 0.0;
  }

  draw() {
    // This drawing code draws the circle body and the "eye".
    // To do this, we use a translation to move the blob's position,
    // then draw using relative coordinates.
    push();
    const sz = this.size; // We use size a lot in this method -- store it
    // Move to the center of the blob
    translate(this.x + sz, this.y + sz);
    scale(sz);
    // Rotate the blob. You won't see this when drawing the first oval,
    // since it's round, but it affects x and y coordinates, so the
    // eye will point in the right direction
    rotate(-this.angle);
    // Draw the body
    fill(1, 0, 0);
    oval(-1.0, -1.0, 2.0, 2.0);
    // Draw the eye
    fill(0, 0, 0);
    oval(0.2, -0.5, 1.0, 1.0);
    pop();
  }

  update(hero, blobs) {
    // Increase and decrease the size based on the speed of the blob
    this.size = Math.abs(Math.sin(this.seed + FRAME / (5.0 - this.speed * 2.0)) * 2.0 + this.seed) + 4.0;
    // This code implements the chase behaviour of the blobs.
    // First, calculate the angle between ourselves and the hero
    this.angle = angle(this.x, this.y, hero.x, hero.y);
    // Then, move in that direction using the moving speed
    [this.x, this.y] = coordinates(this.x, this.y, this.speed, this.angle);
    // Calculate if I'm not bumping into another blob. If I am, calculate a new
    // jump to an empty spot on the board.
    for (const blob of blobs) {
      if (blob !== this && Math.abs(distance(this.x, this.y, blob.x, blob.y)) < blob.size * 2) {
        [this.x, this.y] = random_spot_away_from_hero(hero);
      }
    }
  }
}

// Calculate a random spot that is at least mindist away from the hero.
function random_spot_away_from_hero(hero, mindist = 20.0) {
  let dist = 0.0, x, y;
  // We use a brute-force: while we have not found a good point, choose a random
  // point and calculate its distance. Rinse and repeat until a good point is found.
  while (dist < mindist) {
    x = randint(WIDTH);
    y = randint(HEIGHT);
    dist = distance(x, y, hero.x, hero.y);
  }
  return [x, y];
}

const now = () => performance.now() / 1000;

let hero, blobs, gameover, starttime, endtime;

// The setup of the game. This initializes the positions of the hero and the blobs,
// sets the begintime and various other constants.
function setup() {
  hero = new Hero(100, 100);
  blobs = [];
  gameover = false;
  endtime = null;
  starttime = now();
  for (let i = 0; i < 10; i++) {
    const [x, y] = random_spot_away_from_hero(hero);
    blobs.push(new Blob(x, y));
  }
}

// The main game loop
function draw() {
  // To make things a little more interesting, we rotate and scale the canvas while
  // the game is running. For this to work, we need corner-mode transformations.
  transform(CORNER);
  // Move to the middle of the screen to set the rotation. This makes sure the rotation
  // isn't applied from a corner, but from the middle of the screen.
  translate(WIDTH / 2, HEIGHT / 2);
  // The rotation amount and speed is linked to the current FRAME. The farther in the game,
  // the faster and bigger the rotation gets
  rotate(Math.sin(FRAME / 70.0) * FRAME / 10.0);
  // The speed of the scaling is also linked to the current FRAME.
  scale(0.6 + Math.abs(Math.sin(FRAME / 100.0) * 0.4));
  // Move the canvas back. The rotation is now applied.
  translate(-WIDTH / 2, -HEIGHT / 2);

  // Draw a rectangle, defining the playing field
  stroke(0);
  nofill();
  rect(0, 0, WIDTH, HEIGHT - STATUS_BAR_HEIGHT);
  nostroke();

  // The following applies when the game is not over,
  // in other words when we are still playing.
  if (!gameover) {
    // Check the keys and move the hero accordingly.
    // The min and max lines keep the hero within the bounds
    // of the playing field
    if (keydown) {
      if (keycode === KEY_UP) {
        hero.y -= hero.speed;
        hero.y = Math.max(hero.size, hero.y);
      }
      if (keycode === KEY_DOWN) {
        hero.y += hero.speed;
        hero.y = Math.min(WIDTH - hero.size, hero.y);
      }
      if (keycode === KEY_LEFT) {
        hero.x -= hero.speed;
        hero.x = Math.max(hero.size, hero.x);
      }
      if (keycode === KEY_RIGHT) {
        hero.x += hero.speed;
        hero.x = Math.min(WIDTH - hero.size, hero.x);
      }
    }

    // Update the blobs. This part is the actual "intelligence" of the game.
    // This routine also calculates if one of the blobs hits your hero, in
    // which case the game is over.
    for (const blob of blobs) {
      blob.update(hero, blobs);
      if (Math.abs(distance(hero.x, hero.y, blob.x, blob.y)) < blob.size + hero.size) {
        gameover = true;
        // The endtime stores how long we survived.
        endtime = now();
      }
    }
  }

  // Draw everything. This is done even when the game is over.
  hero.draw();
  for (const blob of blobs) blob.draw();

  // The status indicators are drawn on-screen without all the funky rotations
  // and scaling. Reset the canvas.
  reset();

  // The time to display is either the endtime (on gameover), or the current time.
  const t = endtime !== null ? endtime - starttime : now() - starttime;
  // Draw the time
  fontsize(12);
  fill(0, 0.6);
  rect(0, HEIGHT - STATUS_BAR_HEIGHT, WIDTH, STATUS_BAR_HEIGHT);
  fill(1);
  text(`${t.toFixed(2)} seconds`, 5, HEIGHT - 2);

  // If the game is over, scale up the hero to get a black screen
  // and draw the "GAME OVER" message
  if (gameover) {
    if (hero.size < 500) hero.size += 30.0;
    fill(1);
    text('GAME OVER', WIDTH / 2.0 - textwidth('game over') / 2.0, HEIGHT / 2);
  }
}
