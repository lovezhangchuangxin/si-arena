import type { DeepReadonly } from "@si-arena/protocol";
import type { RoyaleEvent, RoyaleState } from "../sdk";
import { ROYALE_PALETTE } from "./palette";

/**
 * Transient presentation input for one tick. The world itself is always drawn from `state`;
 * events only add decaying highlights, interpolated head motion and error badges.
 */
export interface RoyaleBoardAnimation {
  previousState: DeepReadonly<RoyaleState>;
  events: DeepReadonly<RoyaleEvent[]>;
  /** Fraction of the current tick's animation window, 0..1; 1 (or a missing animation) draws the settled board. */
  progress: number;
  reducedMotion: boolean;
  /** Player ids whose execution errored on the input tick that produced the current world. */
  erroredPlayers: ReadonlySet<string>;
}

export function royalePlayerSummaries(state: DeepReadonly<RoyaleState>) {
  const areas = state.players.map(() => 0);
  for (const owner of state.territory) if (owner >= 0) areas[owner]!++;
  return state.players.map((player) => ({
    id: player.id,
    label: `P${player.slot + 1}`,
    color: ROYALE_PALETTE.players[player.slot]!,
    score: areas[player.slot]!,
    alive: player.death === null,
  }));
}

type Point = { x: number; y: number };
type MoveEvent = Extract<DeepReadonly<RoyaleEvent>, { type: "move" }>;

function colorOf(state: DeepReadonly<RoyaleState>, playerId: string): string | undefined {
  const slot = state.players.find((player) => player.id === playerId)?.slot;
  return slot === undefined ? undefined : ROYALE_PALETTE.players[slot];
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

function drawRing(
  context: CanvasRenderingContext2D,
  center: Point,
  radius: number,
  color: string,
  alpha: number,
  span: number,
): void {
  context.globalAlpha = alpha;
  context.strokeStyle = color;
  context.lineWidth = Math.max(2, span * 0.08);
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  context.stroke();
}

/** Draw authoritative grid state; rendering never modifies or advances the rules. */
export function drawRoyaleBoard(
  context: CanvasRenderingContext2D,
  state: DeepReadonly<RoyaleState>,
  width: number,
  height: number,
  animation?: RoyaleBoardAnimation,
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
  const zoneMin = (state.width - state.zoneSize) / 2;
  const zone = {
    x: zoneMin * cellWidth,
    y: zoneMin * cellHeight,
    width: state.zoneSize * cellWidth,
    height: state.zoneSize * cellHeight,
  };

  context.save();
  context.globalAlpha = 1;
  context.fillStyle = ROYALE_PALETTE.outsideZone;
  context.fillRect(0, 0, width, height);
  context.fillStyle = ROYALE_PALETTE.ground;
  context.fillRect(zone.x, zone.y, zone.width, zone.height);
  const surface = context.createLinearGradient(0, 0, width, height);
  surface.addColorStop(0, "#12273b99");
  surface.addColorStop(0.5, "#07101b00");
  surface.addColorStop(1, "#17263f66");
  context.fillStyle = surface;
  context.fillRect(0, 0, width, height);

  context.globalAlpha = ROYALE_PALETTE.territoryAlpha;
  // One continuous colour wash per seat keeps large territories luminous without tile seams.
  const territoryFills = ROYALE_PALETTE.players.map((color) => {
    const fill = context.createLinearGradient(0, 0, width * 0.35, height);
    fill.addColorStop(0, color);
    fill.addColorStop(0.55, color);
    fill.addColorStop(1, `${color}B3`);
    return fill;
  });
  for (let index = 0; index < state.territory.length; index++) {
    const owner = state.territory[index]!;
    if (owner < 0) continue;
    context.fillStyle = territoryFills[owner]!;
    context.fillRect(
      (index % state.width) * cellWidth,
      Math.floor(index / state.width) * cellHeight,
      cellWidth,
      cellHeight,
    );
  }

  // A continuous luminous border separates owned land from the neutral grid.
  for (let index = 0; index < state.territory.length; index++) {
    const owner = state.territory[index]!;
    if (owner < 0) continue;
    const gx = index % state.width,
      gy = Math.floor(index / state.width);
    const x = gx * cellWidth,
      y = gy * cellHeight;
    context.globalAlpha = 0.7;
    context.fillStyle = ROYALE_PALETTE.players[owner]!;
    const edge = Math.max(0.6, span * 0.06);
    if (gx === 0 || state.territory[index - 1] !== owner) context.fillRect(x, y, edge, cellHeight);
    if (gx === state.width - 1 || state.territory[index + 1] !== owner)
      context.fillRect(x + cellWidth - edge, y, edge, cellHeight);
    if (gy === 0 || state.territory[index - state.width] !== owner)
      context.fillRect(x, y, cellWidth, edge);
    if (gy === state.height - 1 || state.territory[index + state.width] !== owner)
      context.fillRect(x, y + cellHeight - edge, cellWidth, edge);
  }
  context.globalAlpha = 1;
  context.globalAlpha = 0.5;
  context.strokeStyle = ROYALE_PALETTE.grid;
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
  context.globalAlpha = ROYALE_PALETTE.trailAlpha;
  for (let index = 0; index < state.trails.length; index++) {
    const owner = state.trails[index]!;
    if (owner < 0) continue;
    context.fillStyle = ROYALE_PALETTE.players[owner]!;
    context.fillRect(
      (index % state.width) * cellWidth + cellWidth * 0.18,
      Math.floor(index / state.width) * cellHeight + cellHeight * 0.18,
      cellWidth * 0.64,
      cellHeight * 0.64,
    );
  }

  context.globalAlpha = 1;
  for (let index = 0; index < state.trails.length; index++) {
    const owner = state.trails[index]!;
    if (owner < 0) continue;
    const x = (index % state.width) * cellWidth,
      y = Math.floor(index / state.width) * cellHeight;
    context.shadowColor = ROYALE_PALETTE.players[owner]!;
    context.shadowBlur = Math.min(12, span * 0.8);
    context.fillStyle = ROYALE_PALETTE.players[owner]!;
    context.fillRect(x + cellWidth * 0.2, y + cellHeight * 0.2, cellWidth * 0.6, cellHeight * 0.6);
    context.shadowBlur = 0;
    context.fillStyle = "#E8F8FF";
    context.globalAlpha = 0.5;
    context.fillRect(
      x + cellWidth * 0.24,
      y + cellHeight * 0.24,
      cellWidth * 0.5,
      Math.max(0.5, cellHeight * 0.08),
    );
    context.globalAlpha = 1;
  }
  context.globalAlpha = 1;
  // A ring that just closed fades out from where the zone used to end.
  const shrink = showMarks ? events.find((event) => event.type === "zone-shrink") : undefined;
  if (shrink) {
    context.globalAlpha = markAlpha;
    context.strokeStyle = ROYALE_PALETTE.warning;
    context.lineWidth = Math.max(1.5, span * 0.12);
    context.strokeRect(
      zone.x - cellWidth,
      zone.y - cellHeight,
      zone.width + 2 * cellWidth,
      zone.height + 2 * cellHeight,
    );
    context.globalAlpha = 1;
  }
  context.strokeStyle = ROYALE_PALETTE.zoneBorder;
  context.lineWidth = Math.max(1.5, span * 0.12);
  context.strokeRect(zone.x, zone.y, zone.width, zone.height);
  // Captured cells flash under the heads; an empty capture closes without gaining ground.
  if (showMarks) {
    for (const event of events) {
      if (event.type !== "capture" || event.cells.length === 0) continue;
      const color = colorOf(state, event.playerId);
      if (!color) continue;
      for (const index of event.cells) {
        const x = (index % state.width) * cellWidth,
          y = Math.floor(index / state.width) * cellHeight;
        if (transient) {
          context.globalAlpha = 0.45 * (1 - progress);
          context.fillStyle = color;
          context.fillRect(x, y, cellWidth, cellHeight);
        } else {
          context.globalAlpha = markAlpha;
          context.strokeStyle = color;
          context.lineWidth = Math.max(1.5, cellWidth * 0.08);
          context.strokeRect(x + 1, y + 1, cellWidth - 2, cellHeight - 2);
        }
      }
    }
    context.globalAlpha = 1;
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

    context.shadowColor = ROYALE_PALETTE.players[player.slot]!;
    context.shadowBlur = Math.min(18, span * 1.2);
    context.fillStyle = ROYALE_PALETTE.players[player.slot]!;
    context.fillRect(x, y, cellWidth, cellHeight);
    context.shadowBlur = 0;
    const glass = context.createLinearGradient(x, y, x + cellWidth, y + cellHeight);
    glass.addColorStop(0, "#FFFFFF88");
    glass.addColorStop(0.45, "#FFFFFF00");
    glass.addColorStop(1, "#021B4B99");
    context.fillStyle = glass;
    context.fillRect(x, y, cellWidth, cellHeight);

    context.strokeStyle = ROYALE_PALETTE.headRing;
    context.lineWidth = Math.max(1, cellWidth / 8);
    context.strokeRect(x + 0.5, y + 0.5, cellWidth - 1, cellHeight - 1);
    context.fillStyle = ROYALE_PALETTE.ground;
    context.font = `bold ${Math.max(7, cellHeight * 0.7)}px monospace`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    if (span >= 8) context.fillText(String(player.slot + 1), x + cellWidth / 2, y + cellHeight / 2);
    else {
      // Tiny views use two visor pixels instead of a numeral wider than the cell.
      context.fillRect(
        x + cellWidth * 0.23,
        y + cellHeight * 0.28,
        cellWidth * 0.16,
        cellHeight * 0.22,
      );
      context.fillRect(
        x + cellWidth * 0.61,
        y + cellHeight * 0.28,
        cellWidth * 0.16,
        cellHeight * 0.22,
      );
    }
  }
  if (showMarks) {
    for (const event of events) {
      if (event.type === "trail-cut") {
        const attacker = colorOf(state, event.attackerId);
        if (attacker)
          drawCross(context, event.position, attacker, markAlpha, cellWidth, cellHeight);
      } else if (event.type === "death") {
        const victim = colorOf(state, event.playerId);
        if (!victim) continue;
        // The head is gone, so a widening ring and a cross mark where it fell.
        drawRing(
          context,
          { x: (event.position.x + 0.5) * cellWidth, y: (event.position.y + 0.5) * cellHeight },
          transient ? (0.25 + 0.5 * progress) * span : 0.4 * span,
          victim,
          markAlpha,
          span,
        );
        drawCross(context, event.position, victim, markAlpha, cellWidth, cellHeight);
      }
    }
    context.globalAlpha = 1;
  }
  if (animation !== undefined) {
    for (const playerId of animation.erroredPlayers) {
      // The badge follows the drawn head; a player eliminated this tick falls back
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
      context.fillStyle = ROYALE_PALETTE.warning;
      context.beginPath();
      context.arc(center.x, center.y, radius, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = ROYALE_PALETTE.warningInk;
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
