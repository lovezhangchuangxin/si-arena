export const CUBE_SDK_SOURCE = String.raw`
const MOVES = ["U","U2","U'","D","D2","D'","L","L2","L'","R","R2","R'","F","F2","F'","B","B2","B'"];
const freeze = Object.freeze;
export default function createGame(observation, {submit, reject}) {
  submit({type:'idle'});
  const self = freeze({
    id: observation.selfId,
    turn(move) {
      if (typeof move !== 'string' || MOVES.indexOf(move) < 0) {
        reject('Move must be one of ' + MOVES.join(' '));
      }
      submit({type:'move', move});
    }
  });
  return freeze({
    tick: observation.tick, maxTicks: observation.maxTicks,
    facelets: freeze(observation.facelets.slice()),
    moves: observation.moves, score: observation.score, solved: observation.solved,
    scrambleLength: observation.scrambleLength,
    events: freeze(observation.events.slice()),
    self
  });
}
`;
