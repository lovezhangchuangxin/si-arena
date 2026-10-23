export const TETRIS_PALETTE = Object.freeze({
  ground: "#0F131A",
  grid: "#1A2029",
  ghostAlpha: 0.18,
  activeRing: "#F4F7FB",
  panelInk: "#8B94A3",
  /** Locked-cell colors by piece type index 1–7: I O T S Z J L. */
  pieces: Object.freeze([
    "#5B8CFF", // I
    "#FFD166", // O
    "#C084FC", // T
    "#2ED3B7", // S
    "#FF6B5B", // Z
    "#5E8CFF", // J (hue-shifted duplicate avoided by tone)
    "#FF9F1C", // L
  ] as const),
  players: Object.freeze(["#5B8CFF"] as const),
});
