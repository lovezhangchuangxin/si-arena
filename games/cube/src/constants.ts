/** Public, frozen configuration. The scramble depth is the only tunable. */
export const CUBE_CONFIG = Object.freeze({
  /** Quarter/half turns applied to the solved cube before the run starts. */
  scramble: 22,
} as const);

/**
 * Ticks are thinking time: a move costs one tick, but so does a tick spent
 * planning. The run is a race against the move counter, not against the clock.
 */
export const CUBE_MAX_TICKS = 400;
export const CUBE_PLAYERS = 1;
export const CUBE_FACES = 6;
export const CUBE_FACELETS = 54;
/** Stickers per face. */
export const CUBE_FACE_STICKERS = 9;

/** A perfect run would score this; every move costs `CUBE_MOVE_COST`. */
export const CUBE_SCORE_BASE = 2000;
export const CUBE_MOVE_COST = 10;
/** Moves after which the score reaches zero; the run can still continue. */
export const CUBE_SCORE_ZERO_MOVES = CUBE_SCORE_BASE / CUBE_MOVE_COST;
