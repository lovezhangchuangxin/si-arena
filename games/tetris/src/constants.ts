export const TETRIS_CONFIG = Object.freeze({
  width: 10,
  height: 20,
  /** Gravity interval in ticks at level 1. */
  fallBase: 12,
  /** The interval never drops below this, whatever the level. */
  fallMin: 1,
} as const);
export const TETRIS_MAX_TICKS = 1500;
export const TETRIS_PLAYERS = 1;
/** Points for locking lines: cleared lines × current level. */
export const TETRIS_LINE_POINTS = Object.freeze([0, 1, 2, 3, 4] as const);
/** A level every this many cleared lines, up to the speed floor. */
export const TETRIS_LINES_PER_LEVEL = 10;
export const TETRIS_CELLS = TETRIS_CONFIG.width * TETRIS_CONFIG.height;
