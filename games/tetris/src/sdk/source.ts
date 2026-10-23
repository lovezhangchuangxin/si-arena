/** Trusted guest ESM. This game alone defines its methods and canonical intent. */
export const TETRIS_SDK_SOURCE = String.raw`
const freeze = Object.freeze;
export default function createGame(observation, {submit, reject}) {
  const piece = freeze({ ...observation.piece });
  submit({type:'idle'});
  const self = freeze({
    id: observation.selfId,
    move(direction) {
      if (direction !== 'left' && direction !== 'right' && direction !== 'down') {
        reject('Direction must be left, right or down');
      }
      submit({type:'move', direction});
    },
    rotate(rotation) {
      if (rotation !== 'cw' && rotation !== 'ccw') {
        reject('Rotation must be cw or ccw');
      }
      submit({type:'rotate', rotation});
    },
    drop() {
      submit({type:'drop'});
    }
  });
  return freeze({
    tick: observation.tick, maxTicks: observation.maxTicks,
    board: freeze({ ...observation.board, cells: freeze(observation.board.cells.slice()) }),
    piece, next: observation.next,
    lines: observation.lines, score: observation.score, level: observation.level,
    fallInterval: observation.fallInterval,
    events: freeze(observation.events.slice()), self
  });
}
`;
