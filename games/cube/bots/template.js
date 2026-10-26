/**
 * Template bot for 魔方 (cube): a modest starting point.
 *
 * Each tick it simulates all eighteen moves on a copy of the cube and plays the
 * one that leaves the most stickers on their home face, skipping an immediate
 * repeat of the same face. Greedy alone will not solve a Rubik's cube — it
 * settles into local minima — so read this as the shape of a bot (read the
 * state, simulate, choose, remember) rather than as a strategy. A scoring entry
 * needs a method: layer by layer, corners first, or a two-phase search.
 *
 * Facelets are 54 numbers in U R F D L B blocks of nine; sticker i belongs on
 * face floor(i / 9) when the cube is solved.
 */

/** Destination of every sticker after one clockwise quarter turn, one char per sticker. */
const TURNS = {
  U: "258147036ijkcdefghABClmnopqrstuvwxyzJKLDEFGHI9abMNOPQR",
  R: "01P34M67Jbehadg9cfij2lm5op8rskuvnxyqABCDEFGHIzKLwNOtQR",
  F: "0123459cftabsderghknqjmpiloCFIuvwxyzAB8DE7GH6JKLMNOPQR",
  D: "0123456789abcdePQRijklmnfghtwzsvyruxABCDEFopqJKLMNOGHI",
  L: "i12l45o789abcdefghrjkumnxpqRstOvwLyzCFIBEHADGJK6MN3PQ0",
  B: "GDA3456789a0cd1fg2ijklmnopqrstuvwhebxBCyEFzHILORKNQJMP",
};
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWX";
const MOVES = [
  "U",
  "U2",
  "U'",
  "D",
  "D2",
  "D'",
  "L",
  "L2",
  "L'",
  "R",
  "R2",
  "R'",
  "F",
  "F2",
  "F'",
  "B",
  "B2",
  "B'",
];

const DESTINATION = {};
for (const face of Object.keys(TURNS))
  DESTINATION[face] = Array.from(TURNS[face], (letter) => ALPHABET.indexOf(letter));

function apply(facelets, move) {
  const face = move[0];
  const turns = move.length === 1 ? 1 : move[1] === "2" ? 2 : 3;
  let state = facelets;
  for (let step = 0; step < turns; step++) {
    const destination = DESTINATION[face];
    const next = Array.from({ length: 54 }, () => 0);
    for (let index = 0; index < 54; index++) next[destination[index]] = state[index];
    state = next;
  }
  return state;
}

function solvedStickers(facelets) {
  let total = 0;
  for (let index = 0; index < 54; index++) if (facelets[index] === Math.floor(index / 9)) total++;
  return total;
}

export default function tick({ game, Memory }) {
  const lastFace = typeof Memory.last === "string" ? Memory.last[0] : "";
  let bestMove = "U";
  let bestScore = -1;
  for (const move of MOVES) {
    if (move[0] === lastFace) continue;
    const score = solvedStickers(apply(game.facelets, move));
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  Memory.last = bestMove;
  game.self.turn(bestMove);
}
