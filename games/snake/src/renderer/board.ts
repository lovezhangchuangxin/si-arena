import type { DeepReadonly } from "@si-arena/protocol";
import type { SnakeEvent, SnakePosition, SnakeState } from "../sdk";
import { SNAKE_PALETTE } from "./palette";

/**
 * Transient presentation input for one tick. The world itself is always drawn from `state`;
 * events only add decaying marks, interpolated head and tail motion and error badges.
 */
export interface SnakeBoardAnimation {
  previousState: DeepReadonly<SnakeState>;
  events: DeepReadonly<SnakeEvent[]>;
  /** Fraction of the current tick's animation window, 0..1; 1 (or a missing animation) draws the settled board. */
  progress: number;
  reducedMotion: boolean;
  /** Player ids whose execution errored on the input tick that produced the current world. */
  erroredPlayers: ReadonlySet<string>;
}

export function snakePlayerSummaries(state: DeepReadonly<SnakeState>) {
  return state.snakes.map((snake) => ({
    id: snake.id,
    label: `P${snake.slot + 1}`,
    color: SNAKE_PALETTE.players[snake.slot]!,
    score: snake.body.length,
    alive: snake.death === null,
  }));
}

type Point = { x: number; y: number };
type MoveEvent = Extract<DeepReadonly<SnakeEvent>, { type: "move" }>;

function colorOf(state: DeepReadonly<SnakeState>, playerId: string): string | undefined {
  const slot = state.snakes.find((snake) => snake.id === playerId)?.slot;
  return slot === undefined ? undefined : SNAKE_PALETTE.players[slot];
}

/** A segment as an inset square; `inset` is the fraction of the cell left clear on each side. */
function drawSegment(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  cellWidth: number,
  cellHeight: number,
  inset: number,
): void {
  context.fillRect(
    x + cellWidth * inset,
    y + cellHeight * inset,
    cellWidth * (1 - 2 * inset),
    cellHeight * (1 - 2 * inset),
  );
  const gloss = context.createLinearGradient(x, y, x + cellWidth, y + cellHeight);
  gloss.addColorStop(0, "#FFFFFF66");
  gloss.addColorStop(0.45, "#FFFFFF00");
  gloss.addColorStop(1, "#001E4D88");
  const color = context.fillStyle;
  context.fillStyle = gloss;
  context.fillRect(
    x + cellWidth * inset,
    y + cellHeight * inset,
    cellWidth * (1 - 2 * inset),
    cellHeight * (1 - 2 * inset),
  );
  context.fillStyle = color;
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

const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));

/** Draw authoritative grid state; rendering never modifies or advances the rules. */
export function drawSnakeBoard(
  context: CanvasRenderingContext2D,
  state: DeepReadonly<SnakeState>,
  width: number,
  height: number,
  animation?: SnakeBoardAnimation,
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

  context.save();
  context.globalAlpha = 1;
  context.fillStyle = SNAKE_PALETTE.ground;
  context.fillRect(0, 0, width, height);
  const surface = context.createLinearGradient(0, 0, width, height);
  surface.addColorStop(0, "#12273b99");
  surface.addColorStop(0.5, "#07101b00");
  surface.addColorStop(1, "#17263f66");
  context.fillStyle = surface;
  context.fillRect(0, 0, width, height);

  context.strokeStyle = SNAKE_PALETTE.grid;
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
  context.fillStyle = SNAKE_PALETTE.food;
  context.shadowColor = SNAKE_PALETTE.food;
  context.shadowBlur = Math.min(16, span);
  for (const food of state.food) {
    context.beginPath();
    context.arc(
      (food.x + 0.5) * cellWidth,
      (food.y + 0.5) * cellHeight,
      span * 0.28,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
  context.shadowBlur = 0;
  const headPoints = new Map<string, Point>();
  for (const snake of state.snakes) {
    if (snake.death) continue;
    const color = SNAKE_PALETTE.players[snake.slot]!;
    const occupied = new Set(snake.body.map((cell) => cell.y * state.width + cell.x));
    context.fillStyle = color;
    context.globalAlpha = SNAKE_PALETTE.bodyAlpha;
    for (let index = 1; index < snake.body.length; index++) {
      const cell = snake.body[index]!;
      drawSegment(context, cell.x * cellWidth, cell.y * cellHeight, cellWidth, cellHeight, 0.12);
    }
    // The tail that was just vacated shrinks away while the head slides into its new cell.
    const previousTail = transient
      ? animation.previousState.snakes.find((other) => other.id === snake.id)?.body.at(-1)
      : undefined;
    if (previousTail && !occupied.has(previousTail.y * state.width + previousTail.x)) {
      context.globalAlpha = SNAKE_PALETTE.bodyAlpha * (1 - progress);
      drawSegment(
        context,
        previousTail.x * cellWidth,
        previousTail.y * cellHeight,
        cellWidth,
        cellHeight,
        0.12 + 0.38 * progress,
      );
    }
    const head = snake.body[0]!;
    const move = transient ? moves.get(snake.id) : undefined;
    const gridX = move ? move.from.x + (move.to.x - move.from.x) * progress : head.x;
    const gridY = move ? move.from.y + (move.to.y - move.from.y) * progress : head.y;
    const x = gridX * cellWidth,
      y = gridY * cellHeight;
    headPoints.set(snake.id, { x, y });
    context.globalAlpha = 1;
    context.shadowColor = color;
    context.shadowBlur = Math.min(16, span);
    context.fillStyle = color;
    drawSegment(context, x, y, cellWidth, cellHeight, 0.06);
    context.shadowBlur = 0;
    context.strokeStyle = SNAKE_PALETTE.headRing;
    context.lineWidth = Math.max(1, span / 10);
    context.beginPath();
    context.arc(x + cellWidth / 2, y + cellHeight / 2, span * 0.36, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = SNAKE_PALETTE.ground;
    context.font = `bold ${Math.max(7, cellHeight * 0.55)}px monospace`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(snake.slot + 1), x + cellWidth / 2, y + cellHeight / 2);
  }
  context.globalAlpha = 1;
  if (showMarks) {
    for (const event of events) {
      if (event.type !== "death") continue;
      const victim = colorOf(state, event.playerId);
      if (!victim) continue;
      // The body is gone, so a cross marks where the head fell, clamped onto the map.
      const cell: SnakePosition = {
        x: clamp(event.position.x, state.width - 1),
        y: clamp(event.position.y, state.height - 1),
      };
      drawCross(context, cell, victim, markAlpha, cellWidth, cellHeight);
    }
    context.globalAlpha = 1;
  }
  if (animation !== undefined) {
    for (const playerId of animation.erroredPlayers) {
      // The badge follows the drawn head; a snake eliminated this tick falls back
      // to its last head cell in the previous world.
      const head = headPoints.get(playerId);
      const fallback = animation.previousState.snakes.find((snake) => snake.id === playerId)
        ?.body[0];
      const point =
        head ?? (fallback ? { x: fallback.x * cellWidth, y: fallback.y * cellHeight } : null);
      if (!point) continue;
      const radius = span * 0.24;
      const center = { x: point.x + cellWidth - radius, y: point.y + radius };
      context.globalAlpha = 1;
      context.fillStyle = SNAKE_PALETTE.warning;
      context.beginPath();
      context.arc(center.x, center.y, radius, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = SNAKE_PALETTE.warningInk;
      context.font = `bold ${Math.max(7, radius * 1.4)}px monospace`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("!", center.x, center.y);
    }
  }
  context.globalAlpha = 1;
  context.shadowBlur = 0;
  context.strokeStyle = "#62b4d755";
  context.lineWidth = 1;
  context.strokeRect(0.5, 0.5, width - 1, height - 1);
  context.restore();
}
