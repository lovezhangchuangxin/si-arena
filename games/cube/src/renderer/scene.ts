import type { DeepReadonly } from "@si-arena/protocol";
import type { CubeEvent, CubeState } from "../sdk";
import { CUBE_STICKERS, moveFace, moveTurns, type Vec3 } from "../rules/moves";
import { CUBE_PALETTE as PALETTE } from "./palette";

/**
 * Transient presentation input for one tick. The cube itself is always built
 * from `state`; events only add the layer spin and the solved highlight.
 */
export interface CubeSceneAnimation {
  events: DeepReadonly<CubeEvent[]>;
  /** Fraction of the current tick's animation window, 0..1; 1 shows the settled cube. */
  progress: number;
  reducedMotion: boolean;
  /** Player ids whose execution errored on the input tick that produced the current world. */
  erroredPlayers: ReadonlySet<string>;
}

/**
 * One block of the puzzle: its grid position in CSS 3D space (x right, y
 * down, z towards the viewer; components -1/0/1) and the sticker colour
 * facing each world direction, in face order U R F D L B (`null` = bare
 * plastic). The host renders each block as a six-sided element and spins it
 * while `layer` is set.
 */
export interface CubeSceneCubie {
  pos: readonly [number, number, number];
  colours: readonly (string | null)[];
  layer: boolean;
}

/** The in-flight layer turn for this tick, in CSS 3D terms. */
export interface CubeSceneSpin {
  axis: "X" | "Y" | "Z";
  /** Remaining angle at the current progress; 0 once the turn has settled. */
  angle: number;
}

/** Panel figures shown beside the cube; the host lays them out in DOM. */
export interface CubeScenePanel {
  moves: number;
  score: number;
  tick: number;
  maxTicks: number;
  /** The last move of this tick, or "—" before any turn. */
  last: string;
  solved: boolean;
}

/** A complete presentational frame; free of rules, safe to render as DOM. */
export interface CubeScene {
  cubies: readonly CubeSceneCubie[];
  spin: CubeSceneSpin | null;
  /** Camera orientation for the cube element, applied before the host design-scale. */
  view: string;
  panel: CubeScenePanel;
}

/**
 * Stage box around the 3-cube view and its side panel, in design cells; the
 * host scales the fixed design canvas to fit this ratio.
 */
export const CUBE_ASPECT_RATIO = 10.6 / 6.8;

export function cubePlayerSummaries(state: DeepReadonly<CubeState>) {
  return [
    {
      id: state.playerId,
      label: "P1",
      color: PALETTE.players[0]!,
      score: state.score,
      // A solo puzzle never eliminates you; the run just ends when it is solved.
      alive: true,
    },
  ];
}

/** Fixed three-quarter view: the cube turns 34° left and tips 24° forward. */
const VIEW = "rotateX(-24deg) rotateY(-34deg)";

/** CSS coordinates mirror the game's y axis (up becomes down). */
const toCss = ([x, y, z]: Vec3): readonly [number, number, number] => [x, -y, z];

/** Outward normals per face block, in facelet order U R F D L B. */
const NORMALS: readonly Vec3[] = [
  [0, 1, 0],
  [1, 0, 0],
  [0, 0, 1],
  [0, -1, 0],
  [-1, 0, 0],
  [0, 0, -1],
];

/**
 * Per face, the CSS rotation axis and sign of one clockwise quarter turn as
 * seen from outside the face (a `2` turn doubles it, a `'` turn negates it).
 */
const SPIN_AXIS: Readonly<Record<string, { axis: "X" | "Y" | "Z"; sign: number }>> = Object.freeze({
  U: { axis: "Y", sign: -1 },
  R: { axis: "X", sign: 1 },
  F: { axis: "Z", sign: 1 },
  D: { axis: "Y", sign: 1 },
  L: { axis: "X", sign: -1 },
  B: { axis: "Z", sign: -1 },
});

/** Sticker colour for a facelet value; bare plastic is near-black. */
export function cubeStickerColour(facelet: number): string {
  return PALETTE.faces[facelet] ?? "#0d0d11";
}

const FACELET_INDEX = new Map<string, number>(
  CUBE_STICKERS.map((sticker, index) => [
    `${sticker.position.join(",")}|${sticker.normal.join(",")}`,
    index,
  ]),
);

/** The facelet value currently facing `normal` at grid point `pos`, or -1. */
function faceletAt(pos: Vec3, normal: Vec3, facelets: readonly number[]): number {
  const index = FACELET_INDEX.get(`${pos.join(",")}|${normal.join(",")}`);
  return index === undefined ? -1 : facelets[index]!;
}

/** The 26 blocks minus the hidden centre, in (x, y, z) scan order. */
const GRID: readonly (readonly [number, number, number])[] = [-1, 0, 1].flatMap((x) =>
  [-1, 0, 1].flatMap((y) =>
    [-1, 0, 1].flatMap((z) => (x === 0 && y === 0 && z === 0 ? [] : [[x, y, z] as const])),
  ),
);

/**
 * Build the presentational frame for one tick. The layer spin interpolates
 * from the previous layout to the current one: each block of the turned
 * slab carries `angle * (progress - 1)` on top of its settled position, so
 * progress 0 shows the previous world exactly and progress 1 shows this one.
 */
export function cubeScene(
  state: DeepReadonly<CubeState>,
  animation?: CubeSceneAnimation,
): CubeScene {
  const turn = (animation?.events ?? []).findLast((event) => event.type === "turn");
  const progress = animation?.reducedMotion
    ? 1
    : Math.min(1, Math.max(0, animation?.progress ?? 1));
  let spin: CubeSceneSpin | null = null;
  let slabNormal: Vec3 | undefined;
  if (turn?.type === "turn" && progress < 1) {
    const face = moveFace(turn.move);
    const letter = ["U", "R", "F", "D", "L", "B"][face]!;
    const { axis, sign } = SPIN_AXIS[letter]!;
    // Negative remainder: the slab still sits behind its landing spot.
    const quarters = moveTurns(turn.move) === 3 ? -1 : moveTurns(turn.move);
    spin = { axis, angle: sign * 90 * quarters * (progress - 1) };
    slabNormal = NORMALS[face];
  }

  const inSlab = (pos: Vec3) => {
    if (slabNormal === undefined) return false;
    const [nx, ny, nz] = slabNormal;
    return pos[0] * nx + pos[1] * ny + pos[2] * nz === 1;
  };

  const cubies = GRID.map((gamePos) => {
    const colours = NORMALS.map((normal) => {
      const facelet = faceletAt(gamePos, normal, state.facelets);
      return facelet < 0 ? null : cubeStickerColour(facelet);
    });
    return { pos: toCss(gamePos), colours, layer: inSlab(gamePos) };
  });

  return {
    cubies,
    spin,
    view: VIEW,
    panel: {
      moves: state.moves,
      score: state.score,
      tick: state.tick,
      maxTicks: state.maxTicks,
      last: turn?.type === "turn" ? turn.move : "—",
      solved: state.solved,
    },
  };
}
