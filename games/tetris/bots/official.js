/**
 * Official example bot for 俄罗斯方块 (tetris).
 *
 * A one-ply placement search, re-planned every tick: for every rotation and
 * reachable column it drops the piece on a copy of the locked board and scores
 * the resulting stack with classic aggregate-height / holes / bumpiness /
 * cleared-lines weights. The bot then walks the piece to the chosen spot one
 * action per tick - rotate first, then shift, then hard drop.
 */

const WIDTH = 10;
const HEIGHT = 20;
const BOX = { 1: 4, 2: 2, 3: 3, 4: 3, 5: 3, 6: 3, 7: 3 };
const SPAWN = {
  1: [
    [0, 1],
    [1, 1],
    [2, 1],
    [3, 1],
  ],
  2: [
    [1, 0],
    [2, 0],
    [1, 1],
    [2, 1],
  ],
  3: [
    [0, 0],
    [1, 0],
    [2, 0],
    [1, 1],
  ],
  4: [
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
  ],
  5: [
    [0, 0],
    [1, 0],
    [1, 1],
    [2, 1],
  ],
  6: [
    [0, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ],
  7: [
    [2, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ],
};
function rotate(cells, box) {
  return cells.map(([dx, dy]) => [box - 1 - dy, dx]);
}
const SHAPES = {};
for (let type = 1; type <= 7; type++) {
  const rotations = [SPAWN[type]];
  for (let step = 1; step < 4; step++) rotations.push(rotate(rotations[step - 1], BOX[type]));
  SHAPES[type] = rotations;
}

/** The locked board as 0/1 rows, with the falling piece's cells removed. */
function loadBoard(game) {
  const board = [];
  for (let y = 0; y < HEIGHT; y++) {
    const row = Array.from({ length: WIDTH }, () => 0);
    for (let x = 0; x < WIDTH; x++) if (game.board.cells[y * WIDTH + x] !== 0) row[x] = 1;
    board.push(row);
  }
  return board;
}

function fits(board, cells, x, y) {
  return cells.every(([dx, dy]) => {
    const cx = x + dx;
    const cy = y + dy;
    return cx >= 0 && cx < WIDTH && cy >= 0 && cy < HEIGHT && board[cy][cx] === 0;
  });
}

/** Dropping `cells` at column x; returns null when it does not fit even at row 0. */
function simulate(board, cells, x) {
  if (!fits(board, cells, x, 0)) return null;
  let row = 0;
  while (fits(board, cells, x, row + 1)) row++;
  const grid = board.map((line) => line.slice());
  for (const [dx, dy] of cells) grid[row + dy][x + dx] = 1;
  let cleared = 0;
  for (let y = HEIGHT - 1; y >= 0; y--)
    if (grid[y].every((cell) => cell !== 0)) {
      grid.splice(y, 1);
      grid.unshift(Array.from({ length: WIDTH }, () => 0));
      cleared++;
    }
  return { grid, cleared };
}

/** Classic stack evaluation: higher is better. */
function evaluate(grid, cleared) {
  const heights = [];
  let holes = 0;
  for (let x = 0; x < WIDTH; x++) {
    let top = HEIGHT;
    for (let y = 0; y < HEIGHT; y++)
      if (grid[y][x] !== 0) {
        top = y;
        break;
      }
    heights.push(HEIGHT - top);
    for (let y = top + 1; y < HEIGHT; y++) if (grid[y][x] === 0) holes++;
  }
  let bump = 0;
  for (let x = 0; x < WIDTH - 1; x++) bump += Math.abs(heights[x] - heights[x + 1]);
  const aggregate = heights.reduce((sum, height) => sum + height, 0);
  const maxHeight = Math.max(...heights);
  return -0.51 * aggregate - 3.55 * holes - 0.18 * bump + 3.6 * cleared - (maxHeight > 16 ? 4 : 0);
}

/** Best (rotation, x) landing for the current piece, preferring stable stacks. */
function plan(game) {
  const piece = game.piece;
  const board = loadBoard(game);
  let best = null;
  for (let step = 0; step < 4; step++) {
    const targetRotation = (piece.rotation + step) % 4;
    const cells = SHAPES[piece.type][targetRotation];
    const minX = Math.min(...cells.map(([dx]) => dx));
    const maxX = Math.max(...cells.map(([dx]) => dx));
    for (let column = -minX; column <= WIDTH - 1 - maxX; column++) {
      const outcome = simulate(board, cells, column);
      if (!outcome) continue;
      const score =
        evaluate(outcome.grid, outcome.cleared) - Math.abs(column - piece.x) * 0.001 - step * 0.001;
      if (best === null || score > best.score)
        best = { score, rotation: targetRotation, x: column };
    }
  }
  return best;
}

export default function tick({ game }) {
  const target = plan(game);
  if (target === null) {
    game.self.drop();
    return;
  }
  const piece = game.piece;
  const cwSteps = (target.rotation - piece.rotation + 4) % 4;
  if (cwSteps === 3) return game.self.rotate("ccw");
  if (cwSteps > 0) return game.self.rotate("cw");
  if (piece.x < target.x) return game.self.move("right");
  if (piece.x > target.x) return game.self.move("left");
  game.self.drop();
}
