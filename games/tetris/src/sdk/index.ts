export type TetrisMoveDirection = "left" | "right" | "down";
export type TetrisRotationDirection = "cw" | "ccw";

export type TetrisAction =
  | { type: "move"; direction: TetrisMoveDirection }
  | { type: "rotate"; rotation: TetrisRotationDirection }
  | { type: "drop" }
  | { type: "idle" };

/** Tetromino type index; 0 means empty, 1–7 name the seven pieces. */
export type TetrisPieceType = number;

/** The falling piece: cell offsets come from the published shape table. */
export interface TetrisPiece {
  type: TetrisPieceType;
  rotation: number;
  x: number;
  y: number;
}

export type TetrisEvent =
  | { type: "spawn"; playerId: string; piece: TetrisPieceType }
  | { type: "move"; playerId: string; direction: TetrisMoveDirection }
  | { type: "rotate"; playerId: string; rotation: TetrisRotationDirection }
  | { type: "hard-drop"; playerId: string; cells: number }
  | {
      type: "lock";
      playerId: string;
      piece: TetrisPieceType;
      lines: number;
      /** Board rows cleared by this lock, in the pre-clear coordinate system. */
      rows: number[];
      gain: number;
    }
  | { type: "level-up"; playerId: string; level: number }
  | { type: "top-out"; playerId: string };

export interface TetrisState {
  tick: number;
  maxTicks: number;
  width: number;
  height: number;
  /** Row-major occupied cells: 0 empty, else the locked piece's type index. */
  cells: number[];
  /** The falling piece; its cells never overlap the board and stay in bounds. */
  piece: TetrisPiece;
  /** Upcoming types in draw order; queue[0] is the visible next piece. */
  queue: TetrisPieceType[];
  rngState: number;
  lines: number;
  score: number;
  /** 1 + floor(lines / 10); gravity interval shrinks as it grows. */
  level: number;
  /** Ticks since the piece last fell; gravity pulls at the level interval. */
  fallCounter: number;
  /** True once a new piece no longer fits; the world is terminal. */
  over: boolean;
  playerId: string;
}

export interface TetrisObservation {
  tick: number;
  maxTicks: number;
  selfId: string;
  board: { width: number; height: number; cells: number[] };
  piece: TetrisPiece;
  next: TetrisPieceType;
  lines: number;
  score: number;
  level: number;
  /** The gravity interval for the current level, in ticks. */
  fallInterval: number;
  events: TetrisEvent[];
}

/** The entrypoint input trusted guest code receives each tick. */
export interface TetrisTickInput {
  game: {
    tick: number;
    maxTicks: number;
    board: { width: number; height: number; cells: readonly number[] };
    piece: DeepTetrisPiece;
    next: TetrisPieceType;
    lines: number;
    score: number;
    level: number;
    fallInterval: number;
    events: readonly TetrisEvent[];
    self: {
      id: string;
      move(direction: TetrisMoveDirection): undefined;
      rotate(direction: TetrisRotationDirection): undefined;
      drop(): undefined;
    };
  };
  Memory: Record<string, unknown>;
}

interface DeepTetrisPiece {
  readonly type: TetrisPieceType;
  readonly rotation: number;
  readonly x: number;
  readonly y: number;
}
