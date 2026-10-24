import type { DeepReadonly } from "@si-arena/protocol";
import type { TetrisEvent, TetrisState } from "../sdk";
import { SHAPES, fallInterval } from "../rules/state";
import { TETRIS_PALETTE as PALETTE } from "./palette";

/**
 * Transient presentation input for one tick. The world itself is always drawn from `state`;
 * events only add a flash on cleared rows and error badges.
 */
export interface TetrisBoardAnimation {
  previousState: DeepReadonly<TetrisState>;
  events: DeepReadonly<TetrisEvent[]>;
  /** Fraction of the current tick's animation window, 0..1; 1 (or a missing animation) draws the settled board. */
  progress: number;
  reducedMotion: boolean;
  /** Player ids whose execution errored on the input tick that produced the current world. */
  erroredPlayers: ReadonlySet<string>;
}

export function tetrisPlayerSummaries(state: DeepReadonly<TetrisState>) {
  return [
    {
      id: state.playerId,
      label: "P1",
      color: PALETTE.players[0]!,
      score: state.score,
      alive: !state.over,
    },
  ];
}

/** Board (10:20) plus a right-hand panel for the next piece: 0.72 overall. */
export const TETRIS_ASPECT_RATIO = 0.72;
const PANEL_SHARE = 0.3;

export function drawTetrisBoard(
  context: CanvasRenderingContext2D,
  state: DeepReadonly<TetrisState>,
  width: number,
  height: number,
  animation?: TetrisBoardAnimation,
): void {
  const boardWidth = width * (1 - PANEL_SHARE);
  const panelX = boardWidth + width * 0.02;
  const panelWidth = width - panelX;
  const cellWidth = boardWidth / state.width;
  const cellHeight = height / state.height;

  context.save();
  context.fillStyle = PALETTE.ground;
  context.fillRect(0, 0, width, height);
  const surface = context.createLinearGradient(0, 0, width, height);
  surface.addColorStop(0, "#12273b99");
  surface.addColorStop(0.5, "#07101b00");
  surface.addColorStop(1, "#17263f66");
  context.fillStyle = surface;
  context.fillRect(0, 0, width, height);

  // Playfield grid.
  context.strokeStyle = PALETTE.grid;
  context.lineWidth = 1;
  context.beginPath();
  for (let x = 1; x < state.width; x++) {
    context.moveTo(x * cellWidth, 0);
    context.lineTo(x * cellWidth, height);
  }
  for (let y = 1; y < state.height; y++) {
    context.moveTo(0, y * cellHeight);
    context.lineTo(boardWidth, y * cellHeight);
  }
  context.stroke();

  const drawCell = (x: number, y: number, color: string, inset = 0.06, alpha = 1) => {
    context.globalAlpha = alpha;
    context.fillStyle = color;
    context.fillRect(
      x * cellWidth + cellWidth * inset,
      y * cellHeight + cellHeight * inset,
      cellWidth * (1 - 2 * inset),
      cellHeight * (1 - 2 * inset),
    );
    const glass = context.createLinearGradient(
      x * cellWidth,
      y * cellHeight,
      (x + 1) * cellWidth,
      (y + 1) * cellHeight,
    );
    glass.addColorStop(0, "#FFFFFF77");
    glass.addColorStop(0.35, "#FFFFFF00");
    glass.addColorStop(1, "#02193699");
    context.fillStyle = glass;
    context.fillRect(
      x * cellWidth + cellWidth * inset,
      y * cellHeight + cellHeight * inset,
      cellWidth * (1 - 2 * inset),
      cellHeight * (1 - 2 * inset),
    );
    context.strokeStyle = color;
    context.lineWidth = Math.max(0.6, cellWidth * 0.04);
    context.strokeRect(
      x * cellWidth + cellWidth * inset,
      y * cellHeight + cellHeight * inset,
      cellWidth * (1 - 2 * inset),
      cellHeight * (1 - 2 * inset),
    );
    context.globalAlpha = 1;
  };

  const cellsFree = (piece: { type: number; rotation: number; x: number; y: number }) =>
    SHAPES[piece.type]![piece.rotation % 4]!.every(([dx, dy]) => {
      const x = piece.x + dx;
      const y = piece.y + dy;
      return (
        x >= 0 &&
        x < state.width &&
        y >= 0 &&
        y < state.height &&
        state.cells[y * state.width + x] === 0
      );
    });

  // Locked cells.
  for (let y = 0; y < state.height; y++)
    for (let x = 0; x < state.width; x++) {
      const type = state.cells[y * state.width + x]!;
      if (type !== 0) drawCell(x, y, PALETTE.pieces[type - 1]!);
    }

  if (!state.over) {
    // Ghost: where the piece would hard-drop to.
    let dropY = state.piece.y;
    while (cellsFree({ ...state.piece, y: dropY + 1 })) dropY++;
    const ghostCells = SHAPES[state.piece.type]![state.piece.rotation % 4]!;
    for (const [dx, dy] of ghostCells) {
      const y = dropY + dy;
      if (y < state.height)
        drawCell(
          state.piece.x + dx,
          y,
          PALETTE.pieces[state.piece.type - 1]!,
          0.06,
          PALETTE.ghostAlpha,
        );
    }

    // Active piece with a subtle ring.
    for (const [dx, dy] of ghostCells) {
      const x = state.piece.x + dx;
      const y = state.piece.y + dy;
      context.shadowColor = PALETTE.pieces[state.piece.type - 1]!;
      context.shadowBlur = Math.min(16, cellWidth * 0.8);
      drawCell(x, y, PALETTE.pieces[state.piece.type - 1]!);
      context.shadowBlur = 0;
      context.strokeStyle = PALETTE.activeRing;
      context.globalAlpha = 0.5;
      context.strokeRect(
        x * cellWidth + cellWidth * 0.06,
        y * cellHeight + cellHeight * 0.06,
        cellWidth * 0.88,
        cellHeight * 0.88,
      );
      context.globalAlpha = 1;
    }
  }

  // Cleared-row flash: only the rows named by the lock event, mapped from the
  // pre-clear coordinate system (locked rows above a clear shift down by the
  // number of cleared rows below them).
  const locks = (animation?.events ?? []).filter(
    (event): event is Extract<TetrisEvent, { type: "lock" }> => event.type === "lock",
  );
  if (locks.some((event) => event.lines > 0)) {
    context.fillStyle = "#F4F7FB";
    const fade = animation?.reducedMotion
      ? 0.2
      : Math.max(0, 0.55 * (1 - (animation?.progress ?? 1)));
    context.globalAlpha = fade;
    const clearedRows = locks.flatMap((event) => [...event.rows]).toSorted((a, b) => a - b);
    for (const row of new Set(clearedRows)) {
      const shift = clearedRows.filter((cleared) => cleared > row).length;
      const y = row + shift;
      if (y < state.height) context.fillRect(0, y * cellHeight, boardWidth, cellHeight);
    }
    context.globalAlpha = 1;
  }

  // Instrument panels remain part of the same canvas on every surface.
  const unit = panelWidth / 5;
  context.fillStyle = "#0D1A2D";
  context.fillRect(panelX, 0, panelWidth, height);
  context.strokeStyle = "#42668F88";
  context.lineWidth = 1;
  context.strokeRect(0.5, 0.5, boardWidth - 1, height - 1);
  context.strokeRect(panelX + 0.5, 0.5, panelWidth - 1, unit * 3);
  context.fillStyle = "#65D9FF";
  context.fillRect(panelX, 0, panelWidth * 0.28, Math.max(1, height * 0.003));
  context.textAlign = "left";
  context.fillStyle = PALETTE.panelInk;
  context.font = `bold ${Math.max(5, unit * 0.55)}px "JetBrains Mono", monospace`;
  context.textBaseline = "top";
  context.fillText("NEXT", panelX, unit * 0.2);
  const nextType = state.queue[0]!;
  const nextCells = SHAPES[nextType]![0]!;
  const nextOffsetX = nextType === 1 ? 0.5 : 1;
  for (const [dx, dy] of nextCells)
    context.fillRect(
      panelX + (dx + nextOffsetX) * unit,
      unit * 1.1 + dy * unit,
      unit * 0.92,
      unit * 0.92,
    );
  for (const [dx, dy] of nextCells) {
    context.fillStyle = PALETTE.pieces[nextType - 1]!;
    context.fillRect(
      panelX + (dx + nextOffsetX) * unit,
      unit * 1.1 + dy * unit,
      unit * 0.92,
      unit * 0.92,
    );
    context.strokeStyle = "#EBDEFF88";
    context.strokeRect(
      panelX + (dx + nextOffsetX) * unit,
      unit * 1.1 + dy * unit,
      unit * 0.92,
      unit * 0.92,
    );
  }
  const figures: Array<[string, string]> = [
    ["SCORE", String(state.score)],
    ["LINES", String(state.lines)],
    ["LEVEL", String(state.level)],
    ["FALL", `${fallInterval(state.level)}t`],
  ];
  figures.forEach(([label, value], index) => {
    const y = unit * (3.6 + index * 1.6);
    context.fillStyle = "#162840";
    context.fillRect(panelX + unit * 0.2, y - unit * 0.15, panelWidth - unit * 0.4, 1);
    context.fillStyle = PALETTE.panelInk;
    context.font = `bold ${Math.max(4, unit * 0.55)}px "JetBrains Mono", monospace`;
    context.fillText(label, panelX, y);
    context.fillStyle = "#F4F7FB";
    context.font = `bold ${Math.max(5, unit * 0.8)}px "JetBrains Mono", monospace`;
    context.fillText(value, panelX, y + unit * 0.7);
  });
  context.globalAlpha = 1;
  context.shadowBlur = 0;
  context.strokeStyle = "#62b4d755";
  context.lineWidth = 1;
  context.strokeRect(0.5, 0.5, width - 1, height - 1);
  context.restore();
}
