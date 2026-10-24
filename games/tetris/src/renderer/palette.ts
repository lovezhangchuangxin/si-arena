export const TETRIS_PALETTE = Object.freeze({
  ground: "#080F1B",
  grid: "#20344A",
  ghostAlpha: 0.18,
  activeRing: "#F4F7FB",
  panelInk: "#8B94A3",
  /** Locked-cell colors by piece type index 1–7: I O T S Z J L. */
  pieces: Object.freeze([
    "#58A6FF", // I
    "#FFE274", // O
    "#C084FC", // T
    "#43E6BE", // S
    "#FF6B5B", // Z
    "#6E81FF", // J (hue-shifted duplicate avoided by tone)
    "#FF9F1C", // L
  ] as const),
  players: Object.freeze(["#58A6FF"] as const),
});
