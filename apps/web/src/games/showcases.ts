import type { PaperState } from "@si-arena/game-paper/sdk";
import type { RoyaleState } from "@si-arena/game-royale/sdk";
import type { SnakeState, SnakeDirection } from "@si-arena/game-snake/sdk";
import type { BomberState, BomberEvent } from "@si-arena/game-bomber/sdk";
import type { TankState } from "@si-arena/game-tank/sdk";
import type { TetrisState } from "@si-arena/game-tetris/sdk";

type Point = { x: number; y: number };

/** Art-directed snapshots, never simulation input. Every result is checked by its game parser. */
function rectangle(
  grid: number[],
  width: number,
  slot: number,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  for (let row = y; row < y + h; row++)
    for (let column = x; column < x + w; column++) grid[row * width + column] = slot;
}

/** Inclusive orthogonal polyline. Coordinates are cells, not screen positions. */
function path(...corners: Array<readonly [number, number]>): Point[] {
  const result: Point[] = [];
  for (const [x, y] of corners) {
    const previous = result.at(-1);
    if (!previous) {
      result.push({ x, y });
      continue;
    }
    if (previous.x !== x && previous.y !== y) throw new Error("Showcase paths must be orthogonal");
    let cx = previous.x,
      cy = previous.y;
    while (cx !== x || cy !== y) {
      cx += Math.sign(x - cx);
      cy += Math.sign(y - cy);
      result.push({ x: cx, y: cy });
    }
  }
  return result;
}

export function paperShowcase(initial: PaperState): PaperState {
  const state = structuredClone(initial);
  state.tick = 132;
  state.territory.fill(-1);
  rectangle(state.territory, state.width, 0, 2, 14, 10, 13);
  rectangle(state.territory, state.width, 0, 5, 11, 7, 3);
  rectangle(state.territory, state.width, 1, 19, 3, 9, 12);
  rectangle(state.territory, state.width, 1, 16, 3, 3, 6);
  const trails = [
    path([11, 12], [14, 12], [14, 7], [9, 7]),
    path([20, 14], [20, 21], [15, 21], [15, 18]),
  ];
  trails.forEach((cells, slot) => {
    for (const point of cells)
      if (state.territory[point.y * state.width + point.x] !== slot)
        state.trails[point.y * state.width + point.x] = slot;
    state.players[slot]!.position = { ...cells.at(-1)! };
  });
  return state;
}

export function royaleShowcase(initial: RoyaleState): RoyaleState {
  const state = structuredClone(initial);
  state.tick = 120;
  state.territory.fill(-1);
  state.trails.fill(-1);
  // Four remaining contestants make a visibly contracted safe zone possible.
  state.zoneSize = state.width - 4;
  const last = state.players.at(-1)!;
  last.position = null;
  last.death = { tick: 90, causes: ["trail-cut"] };
  const side = state.width;
  const lands = [
    [3, 3],
    [side - 12, 3],
    [3, side - 12],
    [side - 12, side - 12],
  ];
  const routes = [
    path([11, 7], [17, 7], [17, 14]),
    path([side - 10, 11], [side - 10, 17], [side - 17, 17]),
    path([11, side - 7], [16, side - 7], [16, side - 15]),
    path([side - 10, side - 12], [side - 10, side - 18], [side - 6, side - 18]),
  ];
  state.players.slice(0, -1).forEach((player, slot) => {
    const [x, y] = lands[slot]!;
    rectangle(state.territory, side, slot, x!, y!, 9, 9);
    const cells = routes[slot]!;
    for (const point of cells)
      if (state.territory[point.y * side + point.x] !== slot)
        state.trails[point.y * side + point.x] = slot;
    player.position = { ...cells.at(-1)! };
  });
  return state;
}

export function snakeShowcase(initial: SnakeState): SnakeState {
  const state = structuredClone(initial);
  state.tick = 84;
  const bodies = [
    path([13, 3], [5, 3], [5, 6]),
    path([6, 13], [6, 17], [2, 17]),
    path([15, 11], [17, 11], [17, 5]),
    path([10, 15], [15, 15], [15, 17]),
  ];
  const headings: SnakeDirection[] = ["right", "up", "left", "left"];
  state.snakes.forEach((snake, slot) => {
    snake.body = bodies[slot]!;
    snake.heading = headings[slot]!;
    snake.health = 88 - slot * 9;
  });
  state.food = [
    [2, 2],
    [9, 6],
    [12, 9],
    [3, 11],
    [9, 11],
    [11, 17],
    [17, 17],
  ]
    .map(([x, y]) => ({ x: x!, y: y! }))
    .toSorted((a, b) => a.y * state.width + a.x - b.y * state.width - b.x);
  return state;
}

export function bomberShowcase(initial: BomberState): BomberState {
  const state = structuredClone(initial);
  state.tick = 132;
  const clear = (point: Point) => {
    const index = point.y * state.width + point.x;
    state.cells[index] = 0;
    state.hidden[index] = 0;
  };
  const positions = [
    { x: 2, y: 2 },
    { x: 12, y: 2 },
    { x: 2, y: 10 },
    { x: 12, y: 10 },
  ];
  state.players.forEach((player, slot) => {
    player.position = positions[slot]!;
    clear(player.position);
  });
  state.bombs = [
    { position: { x: 4, y: 2 }, owner: 0, fuse: 3, range: 3 },
    { position: { x: 10, y: 10 }, owner: 1, fuse: 6, range: 2 },
  ];
  state.powerups = [
    { position: { x: 8, y: 2 }, kind: "fire" },
    { position: { x: 6, y: 10 }, kind: "bomb" },
  ];
  [...state.bombs, ...state.powerups].forEach((item) => clear(item.position));
  [...path([4, 6], [8, 6]), ...path([6, 4], [6, 8])].forEach(clear);
  return state;
}

export function bomberShowcaseEvents(state: BomberState): BomberEvent[] {
  return [
    {
      type: "explosion",
      bombs: [{ position: { x: 6, y: 6 }, ownerId: state.players[0]!.id }],
      cells: [
        ...new Set(
          [...path([4, 6], [8, 6]), ...path([6, 4], [6, 8])].map((p) => p.y * state.width + p.x),
        ),
      ].toSorted((a, b) => a - b),
      destroyed: [],
    },
  ];
}

export function tankShowcase(initial: TankState): TankState {
  const state = structuredClone(initial);
  state.tick = 96;
  for (let x = 0; x < state.width; x++) state.cells[7 * state.width + x] = 0;
  state.tanks[0]!.position = { x: 5, y: 7 };
  state.tanks[1]!.position = { x: 15, y: 7 };
  state.tanks[0]!.hp = 2;
  state.bullets = [
    { position: { x: 9, y: 7 }, direction: "right", owner: 0 },
    { position: { x: 11, y: 7 }, direction: "left", owner: 1 },
  ];
  return state;
}

export function tetrisShowcase(initial: TetrisState): TetrisState {
  const state = structuredClone(initial);
  state.tick = 240;
  state.lines = 12;
  state.level = 2;
  state.score = 1760;
  [4, 6, 7, 5, 3, 1, 0, 3, 5, 4].forEach((height, x) => {
    for (let y = 0; y < height; y++)
      state.cells[(state.height - 1 - y) * state.width + x] = 1 + ((x + Math.floor(y / 2)) % 7);
  });
  state.piece = { type: 3, rotation: 0, x: 4, y: 5 };
  return state;
}
