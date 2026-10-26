/** The six faces, named by their centre sticker. */
export type CubeFace = "U" | "R" | "F" | "D" | "L" | "B";
/** A quarter turn (`R`), a half turn (`R2`) or a counter-clockwise quarter turn (`R'`). */
export type CubeMove =
  | "U"
  | "U2"
  | "U'"
  | "D"
  | "D2"
  | "D'"
  | "L"
  | "L2"
  | "L'"
  | "R"
  | "R2"
  | "R'"
  | "F"
  | "F2"
  | "F'"
  | "B"
  | "B2"
  | "B'";

/** Facelet values: 0–5 name the six faces (U R F D L B) and never change per face. */
export type CubeFacelet = number;

export type CubeAction = { type: "move"; move: CubeMove } | { type: "idle" };

export type CubeEvent =
  | { type: "turn"; playerId: string; move: CubeMove; moves: number }
  | { type: "solved"; playerId: string; moves: number; score: number };

export interface CubeState {
  tick: number;
  maxTicks: number;
  /** 54 facelets in U R F D L B blocks of nine; the sticker on each face is its face index. */
  facelets: number[];
  /** Moves applied so far; idle ticks are free. */
  moves: number;
  /** Zero until the cube is solved, then `max(0, 2000 - 10 * moves)`. */
  score: number;
  /** True once the cube is solved; the run is terminal. */
  solved: boolean;
  playerId: string;
}

export interface CubeObservation {
  tick: number;
  maxTicks: number;
  selfId: string;
  facelets: number[];
  moves: number;
  score: number;
  solved: boolean;
  /** How many moves the opening scramble used; the sequence itself stays hidden. */
  scrambleLength: number;
  events: CubeEvent[];
}

/** The entrypoint input trusted guest code receives each tick. */
export interface CubeTickInput {
  game: {
    tick: number;
    maxTicks: number;
    facelets: readonly CubeFacelet[];
    moves: number;
    score: number;
    solved: boolean;
    scrambleLength: number;
    events: readonly CubeEvent[];
    self: {
      id: string;
      /** Turns one face; `move` is one of the eighteen published names. */
      turn(move: CubeMove): undefined;
    };
  };
  Memory: Record<string, unknown>;
}
