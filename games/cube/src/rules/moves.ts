import { CUBE_FACELETS, CUBE_FACE_STICKERS, CUBE_FACES } from "../constants";
import type { CubeFace, CubeMove } from "../sdk";

/** Facelet blocks in index order: U 0–8, R 9–17, F 18–26, D 27–35, L 36–44, B 45–53. */
export const CUBE_FACE_ORDER: readonly CubeFace[] = Object.freeze([
  "U",
  "R",
  "F",
  "D",
  "L",
  "B",
] as const);

/** The eighteen legal moves, grouped by face in U D L R F B order. */
const MOVE_FACES = ["U", "D", "L", "R", "F", "B"] as const;
const MOVE_SUFFIXES = ["", "2", "'"] as const;
export const CUBE_MOVES: readonly CubeMove[] = Object.freeze(
  MOVE_FACES.flatMap((face) => MOVE_SUFFIXES.map((suffix) => `${face}${suffix}` as CubeMove)),
);

/** The solved cube: every facelet already carries its own face index. */
export const SOLVED_FACELETS: readonly number[] = Object.freeze(
  Array.from({ length: CUBE_FACELETS }, (_, index) => Math.floor(index / CUBE_FACE_STICKERS)),
);

/** A point or direction in cube space: x right, y up, z front. */
export type Vec3 = readonly [number, number, number];

/** Outward normal per face block. */
const NORMALS: readonly Vec3[] = [
  [0, 1, 0],
  [1, 0, 0],
  [0, 0, 1],
  [0, -1, 0],
  [-1, 0, 0],
  [0, 0, -1],
];

/** Sticker centre on the unfolded net, folded back into cube coordinates. */
function stickerPosition(face: number, slot: number): Vec3 {
  const row = Math.floor(slot / 3);
  const column = slot % 3;
  switch (face) {
    case 0:
      return [column - 1, 1, row - 1];
    case 1:
      return [1, 1 - row, 1 - column];
    case 2:
      return [column - 1, 1 - row, 1];
    case 3:
      return [column - 1, -1, 1 - row];
    case 4:
      return [-1, 1 - row, column - 1];
    default:
      return [1 - column, 1 - row, -1];
  }
}

/**
 * A clockwise turn seen from outside the face, expressed as a -90° rotation
 * about that face's outward normal.
 */
const CLOCKWISE: readonly ((point: Vec3) => Vec3)[] = [
  ([x, y, z]) => [-z, y, x],
  ([x, y, z]) => [x, z, -y],
  ([x, y, z]) => [y, -x, z],
  ([x, y, z]) => [z, y, -x],
  ([x, y, z]) => [x, -z, y],
  ([x, y, z]) => [-y, x, z],
];

const key = (position: Vec3, normal: Vec3) => `${position.join()}@${normal.join()}`;

const STICKERS = Array.from({ length: CUBE_FACELETS }, (_, index) => ({
  position: stickerPosition(Math.floor(index / CUBE_FACE_STICKERS), index % CUBE_FACE_STICKERS),
  normal: NORMALS[Math.floor(index / CUBE_FACE_STICKERS)]!,
}));

/** Sticker centre and outward normal in cube coordinates, indexed by facelet; shared with the renderer. */
export const CUBE_STICKERS: readonly { readonly position: Vec3; readonly normal: Vec3 }[] =
  Object.freeze(
    STICKERS.map((sticker) =>
      Object.freeze({ position: sticker.position, normal: sticker.normal }),
    ),
  );

const STICKER_INDEX = new Map<string, number>(
  STICKERS.map((sticker, index) => [key(sticker.position, sticker.normal), index]),
);

/**
 * `DESTINATIONS[face][i]` is where the sticker at index `i` lands after one
 * clockwise turn of that face. Faces are derived from the same geometry the
 * renderer draws, so the picture and the rules cannot drift apart.
 */
const DESTINATIONS: readonly (readonly number[])[] = CUBE_FACE_ORDER.map((name, face) => {
  const rotate = CLOCKWISE[face]!;
  const normal = NORMALS[face]!;
  return Array.from({ length: CUBE_FACELETS }, (_, index) => {
    const sticker = STICKERS[index]!;
    const onFace =
      sticker.position[0] * normal[0] +
        sticker.position[1] * normal[1] +
        sticker.position[2] * normal[2] ===
      1;
    if (!onFace) return index;
    const target = STICKER_INDEX.get(key(rotate(sticker.position), rotate(sticker.normal)));
    if (target === undefined)
      throw new TypeError(`Cube geometry produced an unknown sticker on ${name}`);
    return target;
  });
});

const FACE_INDEX: Readonly<Record<CubeFace, number>> = Object.freeze({
  U: 0,
  R: 1,
  F: 2,
  D: 3,
  L: 4,
  B: 5,
});

interface MoveSpec {
  face: number;
  /** Quarter turns clockwise: 1 for `R`, 2 for `R2`, 3 for `R'`. */
  turns: number;
}

const MOVE_SPEC: Readonly<Record<CubeMove, MoveSpec>> = Object.freeze(
  Object.fromEntries(
    CUBE_MOVES.map((move) => {
      const letter = move[0] as CubeFace;
      const turns = move.length === 1 ? 1 : move[1] === "2" ? 2 : 3;
      return [move, Object.freeze({ face: FACE_INDEX[letter], turns })];
    }),
  ),
) as Readonly<Record<CubeMove, MoveSpec>>;

/** One clockwise quarter turn of a face; returns a fresh facelet array. */
export function applyTurn(facelets: readonly number[], face: number): number[] {
  const destination = DESTINATIONS[face]!;
  const next = Array.from<number>({ length: CUBE_FACELETS });
  for (let index = 0; index < CUBE_FACELETS; index++) next[destination[index]!] = facelets[index]!;
  return next;
}

export function applyMove(facelets: readonly number[], move: CubeMove): number[] {
  const { face, turns } = MOVE_SPEC[move]!;
  let next = facelets.slice();
  for (let step = 0; step < turns; step++) next = applyTurn(next, face);
  return next;
}

/** True when every facelet sits on its home face; centres never move, so this is exact. */
export function isSolved(facelets: readonly number[]): boolean {
  for (let index = 0; index < CUBE_FACELETS; index++)
    if (facelets[index] !== Math.floor(index / CUBE_FACE_STICKERS)) return false;
  return true;
}

/** The face a move turns, for highlighting. */
export function moveFace(move: CubeMove): number {
  return MOVE_SPEC[move]!.face;
}

/** How many clockwise quarter turns a move applies; renderers animate through them. */
export function moveTurns(move: CubeMove): number {
  return MOVE_SPEC[move]!.turns;
}

export function isCubeMove(raw: unknown): raw is CubeMove {
  return typeof raw === "string" && Object.hasOwn(MOVE_SPEC, raw);
}

/** Sticker positions per face, in net order; shared with the renderer. */
export function faceSlots(face: number): number[] {
  const start = face * CUBE_FACE_STICKERS;
  return Array.from({ length: CUBE_FACE_STICKERS }, (_, slot) => start + slot);
}

export const CUBE_FACE_COUNT = CUBE_FACES;
