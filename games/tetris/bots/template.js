/**
 * Template bot for 俄罗斯方块 (tetris): a modest starting point.
 *
 * It always keeps rotation 0, aims the piece at the column whose stack is
 * currently the lowest (leftmost on ties), and hard drops once there. Replace
 * this heuristic with your own placement search, then verify locally.
 */
export default function tick({ game }) {
  const { board, piece } = game;
  const width = board.width;
  const heights = [];
  for (let x = 0; x < width; x++) {
    let top = board.height;
    for (let y = 0; y < board.height; y++)
      if (board.cells[y * width + x] !== 0) {
        top = y;
        break;
      }
    heights.push(board.height - top);
  }
  let target = 0;
  for (let x = 1; x < width; x++) if (heights[x] < heights[target]) target = x;
  if (piece.x < target) return game.self.move("right");
  if (piece.x > target) return game.self.move("left");
  game.self.drop();
}
