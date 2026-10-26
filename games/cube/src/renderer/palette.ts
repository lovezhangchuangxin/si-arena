export const CUBE_PALETTE = Object.freeze({
  ground: "#0F131A",
  board: "#141A23",
  plate: "#0B0F15",
  panelInk: "#8B94A3",
  panelInkStrong: "#F4F7FB",
  solvedGlow: "#5BE49B",
  /** Sticker colours in facelet order U R F D L B. */
  faces: Object.freeze([
    "#F2F5FA", // U white
    "#FF5A5A", // R red
    "#2FC46B", // F green
    "#FFD166", // D yellow
    "#FF9F1C", // L orange
    "#4C7DFF", // B blue
  ] as const),
  players: Object.freeze(["#5B8CFF"] as const),
});
