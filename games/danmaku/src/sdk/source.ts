/** Trusted guest ESM. This game alone defines its methods and canonical intent. */
export const DANMAKU_SDK_SOURCE = String.raw`
const DIRECTIONS = ["E","NE","N","NW","W","SW","S","SE","hold"];
const SHOTS = ["E","ENE","NE","NNE","N","NNW","NW","WNW","W","WSW","SW","SSW","S","SSE","SE","ESE"];
const SPEEDS = ["slow","fast"];
const freeze = Object.freeze;
const find = Function.prototype.call.bind(Array.prototype.find);
export default function createGame(observation, {submit, reject}) {
  submit({type:'idle'});
  const me = find(observation.ships, (ship) => ship.id === observation.selfId) || null;
  const self = freeze({
    id: observation.selfId, slot: observation.selfSlot,
    position: me && freeze({x: me.position.x, y: me.position.y}),
    velocity: me && freeze({x: me.velocity.x, y: me.velocity.y}),
    hp: me ? me.hp : 0,
    move(direction) {
      if (DIRECTIONS.indexOf(direction) < 0) reject('Direction must be one of ' + DIRECTIONS.join(' '));
      submit({type:'act', move: direction, fire: null, speed: 'slow'});
    },
    fire(direction, speed) {
      if (SHOTS.indexOf(direction) < 0) reject('Shot direction must be one of ' + SHOTS.join(' '));
      if (speed !== undefined && SPEEDS.indexOf(speed) < 0) reject('Speed must be one of ' + SPEEDS.join(' '));
      submit({type:'act', move: null, fire: direction, speed: speed === undefined ? 'slow' : speed});
    },
    act(move, fire, speed) {
      if (move !== null && DIRECTIONS.indexOf(move) < 0) reject('Direction must be one of ' + DIRECTIONS.join(' '));
      if (fire !== null && fire !== undefined && SHOTS.indexOf(fire) < 0) reject('Shot direction must be one of ' + SHOTS.join(' '));
      if (fire && speed !== undefined && SPEEDS.indexOf(speed) < 0) reject('Speed must be one of ' + SPEEDS.join(' '));
      submit({type:'act', move: move, fire: fire === undefined ? null : fire, speed: speed === undefined ? 'slow' : speed});
    },
    idle() { submit({type:'idle'}); }
  });
  return freeze({
    tick: observation.tick, maxTicks: observation.maxTicks,
    width: observation.width, height: observation.height,
    self: self,
    opponent: freeze(find(observation.ships, (ship) => ship.id !== observation.selfId) || null),
    bullets:
      freeze(observation.bullets.map((bullet) => freeze({
        serial: bullet.serial, owner: bullet.owner,
        position: freeze({x: bullet.position.x, y: bullet.position.y}),
        direction: bullet.direction, speed: bullet.speed,
      }))),
    events:
      freeze(observation.events.map((event) => freeze(Object.assign({}, event)))),
  });
}
`;
