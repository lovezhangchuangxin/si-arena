import type { DeepReadonly } from "@si-arena/protocol";
import { BOMBER_CONFIG, CELL_COLLAPSED, CELL_PILLAR, CELL_WALL } from "../constants";
import type { BomberEvent, BomberState } from "../sdk";
import { BOMBER_PALETTE } from "./palette";

/**
 * Transient presentation input for one tick. The world itself is always drawn from `state`;
 * events only add flames, decaying marks, interpolated motion and error badges.
 */
export interface BomberBoardAnimation {
  previousState: DeepReadonly<BomberState>;
  events: DeepReadonly<BomberEvent[]>;
  /** Fraction of the current tick's animation window, 0..1; 1 (or a missing animation) draws the settled board. */
  progress: number;
  reducedMotion: boolean;
  /** Player ids whose execution errored on the input tick that produced the current world. */
  erroredPlayers: ReadonlySet<string>;
}

export function bomberPlayerSummaries(state: DeepReadonly<BomberState>) {
  return state.players.map((player) => ({
    id: player.id,
    label: `P${player.slot + 1}`,
    color: BOMBER_PALETTE.players[player.slot]!,
    score: player.score,
    alive: player.death === null,
  }));
}

type Point = { x: number; y: number };
type MoveEvent = Extract<DeepReadonly<BomberEvent>, { type: "move" }>;

function colorOf(state: DeepReadonly<BomberState>, playerId: string): string | undefined {
  const slot = state.players.find((player) => player.id === playerId)?.slot;
  return slot === undefined ? undefined : BOMBER_PALETTE.players[slot];
}

function drawCross(
  context: CanvasRenderingContext2D,
  cell: Point,
  color: string,
  alpha: number,
  cellWidth: number,
  cellHeight: number,
): void {
  const x = cell.x * cellWidth,
    y = cell.y * cellHeight;
  const insetX = cellWidth * 0.22,
    insetY = cellHeight * 0.22;
  context.globalAlpha = alpha;
  context.strokeStyle = color;
  context.lineWidth = Math.max(2, cellWidth * 0.1);
  context.beginPath();
  context.moveTo(x + insetX, y + insetY);
  context.lineTo(x + cellWidth - insetX, y + cellHeight - insetY);
  context.moveTo(x + cellWidth - insetX, y + insetY);
  context.lineTo(x + insetX, y + cellHeight - insetY);
  context.stroke();
}

function label(
  context: CanvasRenderingContext2D,
  text: string,
  center: Point,
  size: number,
  color: string,
): void {
  context.fillStyle = color;
  context.font = `bold ${Math.max(7, size)}px monospace`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, center.x, center.y);
}

/** Draw authoritative grid state; rendering never modifies or advances the rules. */
export function drawBomberBoard(
  context: CanvasRenderingContext2D,
  state: DeepReadonly<BomberState>,
  width: number,
  height: number,
  animation?: BomberBoardAnimation,
): void {
  const cellWidth = width / state.width,
    cellHeight = height / state.height;
  const span = Math.min(cellWidth, cellHeight);
  const progress = animation === undefined ? 1 : Math.min(1, Math.max(0, animation.progress));
  const reducedMotion = animation?.reducedMotion ?? false;
  // Transient effects animate only inside an armed window; reduced motion keeps the marks
  // of the current tick visible at a fixed intensity instead of animating them.
  const transient = animation !== undefined && !reducedMotion && progress < 1;
  const showMarks = animation !== undefined && (reducedMotion || progress < 1);
  const markAlpha = transient ? 1 - progress : 0.9;
  const events = animation?.events ?? [];
  const moves = new Map<string, MoveEvent>();
  for (const event of events) if (event.type === "move") moves.set(event.playerId, event);
  const origin = (index: number): Point => ({
    x: (index % state.width) * cellWidth,
    y: Math.floor(index / state.width) * cellHeight,
  });

  context.save();
  context.globalAlpha = 1;
  context.fillStyle = BOMBER_PALETTE.ground;
  context.fillRect(0, 0, width, height);
  const surface = context.createLinearGradient(0, 0, width, height);
  surface.addColorStop(0, "#12273b99");
  surface.addColorStop(0.5, "#07101b00");
  surface.addColorStop(1, "#17263f66");
  context.fillStyle = surface;
  context.fillRect(0, 0, width, height);

  for (let index = 0; index < state.cells.length; index++) {
    const cell = state.cells[index]!;
    if (cell === 0) continue;
    const { x, y } = origin(index);
    if (cell === CELL_PILLAR) {
      context.fillStyle = BOMBER_PALETTE.pillar;
      context.fillRect(x, y, cellWidth, cellHeight);
      const metal = context.createLinearGradient(x, y, x + cellWidth, y + cellHeight);
      metal.addColorStop(0, "#9CC9E8");
      metal.addColorStop(0.3, "#38546F");
      metal.addColorStop(1, "#14263E");
      context.fillStyle = metal;
      context.fillRect(
        x + cellWidth * 0.08,
        y + cellHeight * 0.08,
        cellWidth * 0.84,
        cellHeight * 0.84,
      );
      context.strokeStyle = "#92BEDB88";
      context.lineWidth = Math.max(0.5, span * 0.04);
      context.strokeRect(
        x + cellWidth * 0.2,
        y + cellHeight * 0.2,
        cellWidth * 0.6,
        cellHeight * 0.6,
      );
    } else if (cell === CELL_WALL) {
      context.fillStyle = BOMBER_PALETTE.wall;
      context.fillRect(x, y, cellWidth, cellHeight);
      context.fillStyle = BOMBER_PALETTE.wallInset;
      context.fillRect(
        x + cellWidth * 0.2,
        y + cellHeight * 0.2,
        cellWidth * 0.6,
        cellHeight * 0.6,
      );
      context.strokeStyle = "#E4B77B";
      context.lineWidth = Math.max(0.7, span * 0.06);
      context.strokeRect(
        x + cellWidth * 0.1,
        y + cellHeight * 0.1,
        cellWidth * 0.8,
        cellHeight * 0.8,
      );
      context.beginPath();
      context.moveTo(x + cellWidth * 0.18, y + cellHeight * 0.18);
      context.lineTo(x + cellWidth * 0.82, y + cellHeight * 0.82);
      context.moveTo(x + cellWidth * 0.82, y + cellHeight * 0.18);
      context.lineTo(x + cellWidth * 0.18, y + cellHeight * 0.82);
      context.stroke();
    } else if (cell === CELL_COLLAPSED) {
      context.fillStyle = BOMBER_PALETTE.collapsed;
      context.fillRect(x, y, cellWidth, cellHeight);
      context.strokeStyle = BOMBER_PALETTE.hatch;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, y + cellHeight);
      context.lineTo(x + cellWidth, y);
      context.stroke();
    }
  }
  context.strokeStyle = BOMBER_PALETTE.grid;
  context.lineWidth = 0.5;
  context.beginPath();
  for (let x = 0; x <= state.width; x++) {
    context.moveTo(x * cellWidth, 0);
    context.lineTo(x * cellWidth, height);
  }
  for (let y = 0; y <= state.height; y++) {
    context.moveTo(0, y * cellHeight);
    context.lineTo(width, y * cellHeight);
  }
  context.stroke();
  // Flames exist only in the tick of their explosion: an orange cross fading over the window.
  if (showMarks) {
    for (const event of events) {
      if (event.type !== "explosion") continue;
      for (const index of event.cells) {
        const { x, y } = origin(index);
        context.globalAlpha = markAlpha;
        context.shadowColor = BOMBER_PALETTE.flame;
        context.shadowBlur = Math.min(22, span * 1.1);
        context.fillStyle = BOMBER_PALETTE.flame;
        context.fillRect(x, y, cellWidth, cellHeight);
        context.fillStyle = BOMBER_PALETTE.flameCore;
        context.fillRect(
          x + cellWidth * 0.25,
          y + cellHeight * 0.25,
          cellWidth * 0.5,
          cellHeight * 0.5,
        );
      }
    }
    context.globalAlpha = 1;
  }
  context.shadowBlur = 0;
  for (const item of state.powerups) {
    const x = item.position.x * cellWidth,
      y = item.position.y * cellHeight;
    context.fillStyle =
      item.kind === "fire" ? BOMBER_PALETTE.powerupFire : BOMBER_PALETTE.powerupBomb;
    context.fillRect(x + cellWidth * 0.2, y + cellHeight * 0.2, cellWidth * 0.6, cellHeight * 0.6);
    context.strokeStyle = "#E7FFFA";
    context.lineWidth = Math.max(0.7, span * 0.04);
    context.strokeRect(
      x + cellWidth * 0.17,
      y + cellHeight * 0.17,
      cellWidth * 0.66,
      cellHeight * 0.66,
    );
    label(
      context,
      item.kind === "fire" ? "F" : "B",
      { x: x + cellWidth / 2, y: y + cellHeight / 2 },
      cellHeight * 0.5,
      BOMBER_PALETTE.powerupInk,
    );
  }
  for (const bomb of state.bombs) {
    const center = {
      x: (bomb.position.x + 0.5) * cellWidth,
      y: (bomb.position.y + 0.5) * cellHeight,
    };
    context.shadowColor = BOMBER_PALETTE.fuseRing;
    context.shadowBlur = Math.min(12, span * 0.6);
    context.fillStyle = BOMBER_PALETTE.bomb;
    context.beginPath();
    context.arc(center.x, center.y, span * 0.34, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
    context.fillStyle = "#6486B2";
    context.fillRect(center.x - span * 0.18, center.y - span * 0.2, span * 0.12, span * 0.08);
    context.strokeStyle = BOMBER_PALETTE.bombRing;
    context.lineWidth = Math.max(1, span * 0.05);
    context.beginPath();
    context.arc(center.x, center.y, span * 0.34, 0, Math.PI * 2);
    context.stroke();
    // The ring shrinks with the fuse: full at placement, a sliver before the explosion.
    const left = bomb.fuse / (BOMBER_CONFIG.bombFuse - 1);
    context.strokeStyle = BOMBER_PALETTE.fuseRing;
    context.lineWidth = Math.max(1.5, span * 0.1);
    context.beginPath();
    context.arc(center.x, center.y, span * 0.24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
    context.stroke();
  }
  const headPoints = new Map<string, Point>();
  for (const player of state.players) {
    if (!player.position) continue;
    const move = transient ? moves.get(player.id) : undefined;
    const gridX = move ? move.from.x + (move.to.x - move.from.x) * progress : player.position.x;
    const gridY = move ? move.from.y + (move.to.y - move.from.y) * progress : player.position.y;
    const x = gridX * cellWidth,
      y = gridY * cellHeight;
    headPoints.set(player.id, { x, y });
    const center = { x: x + cellWidth / 2, y: y + cellHeight / 2 };
    context.shadowColor = BOMBER_PALETTE.players[player.slot]!;
    context.shadowBlur = Math.min(18, span);
    context.fillStyle = BOMBER_PALETTE.players[player.slot]!;
    context.beginPath();
    context.arc(center.x, center.y, span * 0.4, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = BOMBER_PALETTE.playerRing;
    context.lineWidth = Math.max(1, span / 10);
    context.beginPath();
    context.arc(center.x, center.y, span * 0.4, 0, Math.PI * 2);
    context.stroke();
    context.shadowBlur = 0;
    context.fillStyle = "#041426";
    context.fillRect(center.x - span * 0.26, center.y - span * 0.18, span * 0.52, span * 0.36);
    label(context, String(player.slot + 1), center, cellHeight * 0.48, "#F1FAFF");
  }
  if (showMarks) {
    for (const event of events) {
      if (event.type !== "death") continue;
      const victim = colorOf(state, event.playerId);
      if (victim) drawCross(context, event.position, victim, markAlpha, cellWidth, cellHeight);
    }
    context.globalAlpha = 1;
  }
  if (animation !== undefined) {
    for (const playerId of animation.erroredPlayers) {
      // The badge follows the drawn player; a player eliminated this tick falls back
      // to its last position in the previous world.
      const head = headPoints.get(playerId);
      const fallback = animation.previousState.players.find(
        (player) => player.id === playerId,
      )?.position;
      const point =
        head ?? (fallback ? { x: fallback.x * cellWidth, y: fallback.y * cellHeight } : null);
      if (!point) continue;
      const radius = span * 0.24;
      const center = { x: point.x + cellWidth - radius, y: point.y + radius };
      context.globalAlpha = 1;
      context.fillStyle = BOMBER_PALETTE.warning;
      context.beginPath();
      context.arc(center.x, center.y, radius, 0, Math.PI * 2);
      context.fill();
      label(context, "!", center, radius * 1.4, BOMBER_PALETTE.warningInk);
    }
  }
  context.globalAlpha = 1;
  context.shadowBlur = 0;
  context.strokeStyle = "#62b4d755";
  context.lineWidth = 1;
  context.strokeRect(0.5, 0.5, width - 1, height - 1);
  context.restore();
}
