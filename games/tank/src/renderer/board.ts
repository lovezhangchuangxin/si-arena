import type { DeepReadonly } from "@si-arena/protocol";
import { TANK_CONFIG } from "../constants";
import type { TankDirection, TankEvent, TankState } from "../sdk";
import { TANK_PALETTE } from "./palette";

/**
 * Transient presentation input for one tick. The world itself is always drawn from `state`;
 * events only add decaying highlights, interpolated motion and error badges.
 */
export interface TankBoardAnimation {
  previousState: DeepReadonly<TankState>;
  events: DeepReadonly<TankEvent[]>;
  /** Fraction of the current tick's animation window, 0..1; 1 (or a missing animation) draws the settled board. */
  progress: number;
  reducedMotion: boolean;
  /** Player ids whose execution errored on the input tick that produced the current world. */
  erroredPlayers: ReadonlySet<string>;
}

export function tankPlayerSummaries(state: DeepReadonly<TankState>) {
  return state.tanks.map((tank) => ({
    id: tank.id,
    label: `P${tank.slot + 1}`,
    color: TANK_PALETTE.players[tank.slot]!,
    score: tank.hp,
    alive: tank.death === null,
  }));
}

type Point = { x: number; y: number };
type MoveEvent = Extract<DeepReadonly<TankEvent>, { type: "move" }>;
const DELTAS: Record<TankDirection, readonly [number, number]> = {
  up: [0, -1],
  right: [1, 0],
  down: [0, 1],
  left: [-1, 0],
};

/** Draw authoritative grid state; rendering never modifies or advances the rules. */
export function drawTankBoard(
  context: CanvasRenderingContext2D,
  state: DeepReadonly<TankState>,
  width: number,
  height: number,
  animation?: TankBoardAnimation,
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
  context.fillStyle = TANK_PALETTE.ground;
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
    const x = (index % state.width) * cellWidth,
      y = Math.floor(index / state.width) * cellHeight;
    if (cell === 1) {
      context.fillStyle = TANK_PALETTE.brick;
      context.fillRect(x, y, cellWidth, cellHeight);
      const ceramic = context.createLinearGradient(x, y, x, y + cellHeight);
      ceramic.addColorStop(0, "#F0A26B88");
      ceramic.addColorStop(1, "#22172866");
      context.fillStyle = ceramic;
      context.fillRect(x + 0.5, y + 0.5, cellWidth - 1, cellHeight - 1);
      context.strokeStyle = TANK_PALETTE.mortar;
      context.lineWidth = Math.max(1, span * 0.06);
      context.beginPath();
      context.moveTo(x, y + cellHeight / 2);
      context.lineTo(x + cellWidth, y + cellHeight / 2);
      context.moveTo(x + cellWidth / 2, y);
      context.lineTo(x + cellWidth / 2, y + cellHeight / 2);
      context.moveTo(x + cellWidth / 4, y + cellHeight / 2);
      context.lineTo(x + cellWidth / 4, y + cellHeight);
      context.moveTo(x + (cellWidth * 3) / 4, y + cellHeight / 2);
      context.lineTo(x + (cellWidth * 3) / 4, y + cellHeight);
      context.stroke();
    } else {
      context.fillStyle = TANK_PALETTE.steel;
      context.fillRect(x, y, cellWidth, cellHeight);
      const bevel = Math.max(1, span * 0.14);
      context.fillStyle = TANK_PALETTE.steelLight;
      context.fillRect(x, y, cellWidth, bevel);
      context.fillRect(x, y, bevel, cellHeight);
      context.fillStyle = TANK_PALETTE.steelDark;
      context.fillRect(x, y + cellHeight - bevel, cellWidth, bevel);
      context.fillRect(x + cellWidth - bevel, y, bevel, cellHeight);
    }
  }
  context.strokeStyle = TANK_PALETTE.grid;
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
  // Bricks broken this tick flash out in the attacker's colour.
  if (showMarks) {
    for (const event of events) {
      if (event.type !== "brick-destroyed") continue;
      const slot = state.tanks.find((tank) => tank.id === event.attackerId)?.slot;
      if (slot === undefined) continue;
      context.globalAlpha = 0.5 * markAlpha;
      context.fillStyle = TANK_PALETTE.players[slot]!;
      for (const index of event.cells)
        context.fillRect(
          (index % state.width) * cellWidth,
          Math.floor(index / state.width) * cellHeight,
          cellWidth,
          cellHeight,
        );
    }
    context.globalAlpha = 1;
  }
  const tankPoints = new Map<string, Point>();
  for (const tank of state.tanks) {
    if (!tank.position) continue;
    const move = transient ? moves.get(tank.id) : undefined;
    const gridX = move ? move.from.x + (move.to.x - move.from.x) * progress : tank.position.x;
    const gridY = move ? move.from.y + (move.to.y - move.from.y) * progress : tank.position.y;
    const x = gridX * cellWidth,
      y = gridY * cellHeight;
    tankPoints.set(tank.id, { x, y });
    const color = TANK_PALETTE.players[tank.slot]!;
    const inset = span * 0.14;
    const [dx, dy] = DELTAS[tank.facing];
    // Track pairs follow the tank's facing, with visible treads at large scales.
    context.fillStyle = "#25384E";
    for (const offset of [0.06, 0.76]) {
      if (dx === 0)
        context.fillRect(
          x + cellWidth * offset,
          y + cellHeight * 0.12,
          cellWidth * 0.18,
          cellHeight * 0.76,
        );
      else
        context.fillRect(
          x + cellWidth * 0.12,
          y + cellHeight * offset,
          cellWidth * 0.76,
          cellHeight * 0.18,
        );
    }
    context.shadowColor = color;
    context.shadowBlur = Math.min(16, span * 0.8);
    // Body: a rounded square built from a cross of two rectangles.
    context.fillStyle = color;
    context.fillRect(x + inset, y + inset * 1.6, cellWidth - 2 * inset, cellHeight - 3.2 * inset);
    context.fillRect(x + inset * 1.6, y + inset, cellWidth - 3.2 * inset, cellHeight - 2 * inset);
    context.shadowBlur = 0;
    const armour = context.createLinearGradient(x, y, x + cellWidth, y + cellHeight);
    armour.addColorStop(0, "#D9F5FF99");
    armour.addColorStop(0.5, "#FFFFFF00");
    armour.addColorStop(1, "#041C4B88");
    context.fillStyle = armour;
    context.fillRect(x + inset * 1.6, y + inset, cellWidth - 3.2 * inset, cellHeight - 2 * inset);
    // Barrel from the centre towards the facing edge.
    const centreX = x + cellWidth / 2,
      centreY = y + cellHeight / 2;
    const barrelWidth = Math.max(2, span * 0.16);
    const barrelLength = span / 2;
    context.fillStyle = TANK_PALETTE.barrel;
    if (dx !== 0)
      context.fillRect(
        dx > 0 ? centreX : centreX - barrelLength,
        centreY - barrelWidth / 2,
        barrelLength,
        barrelWidth,
      );
    else
      context.fillRect(
        centreX - barrelWidth / 2,
        dy > 0 ? centreY : centreY - barrelLength,
        barrelWidth,
        barrelLength,
      );
    // Hp pips along the top edge; a lost point stays as a faint slot.
    const pip = Math.max(1.5, span * 0.1);
    const gap = pip * 0.6;
    const total = TANK_CONFIG.initialHp * pip + (TANK_CONFIG.initialHp - 1) * gap;
    for (let point = 0; point < TANK_CONFIG.initialHp; point++) {
      context.fillStyle = point < tank.hp ? TANK_PALETTE.hpPip : TANK_PALETTE.hpLost;
      context.fillRect(centreX - total / 2 + point * (pip + gap), y + inset * 0.3, pip, pip);
    }
  }
  // Bullets slide along their direction during the tick's animation window.
  const slide = transient ? (1 - progress) * 2 : 0;
  context.fillStyle = TANK_PALETTE.bullet;
  for (const bullet of state.bullets) {
    const [dx, dy] = DELTAS[bullet.direction];
    const centreX = (bullet.position.x + 0.5 - dx * slide) * cellWidth,
      centreY = (bullet.position.y + 0.5 - dy * slide) * cellHeight;
    context.shadowColor = TANK_PALETTE.players[bullet.owner]!;
    context.shadowBlur = Math.min(20, span);
    context.strokeStyle = TANK_PALETTE.players[bullet.owner]!;
    context.lineWidth = Math.max(1, span * 0.1);
    context.beginPath();
    context.moveTo(centreX - dx * span * 0.7, centreY - dy * span * 0.7);
    context.lineTo(centreX, centreY);
    context.stroke();
    context.beginPath();
    context.arc(centreX, centreY, Math.max(1.5, span * 0.12), 0, Math.PI * 2);
    context.fill();
  }
  context.shadowBlur = 0;
  if (showMarks) {
    for (const event of events) {
      if (event.type === "hit" || event.type === "death") {
        // A hit flashes a widening ring in the attacker's colour; a death marks the wreck.
        const slot = state.tanks.find(
          (tank) => tank.id === (event.type === "hit" ? event.attackerId : event.playerId),
        )?.slot;
        if (slot === undefined) continue;
        context.globalAlpha = markAlpha;
        context.strokeStyle = TANK_PALETTE.players[slot]!;
        context.lineWidth = Math.max(2, span * 0.08);
        context.beginPath();
        context.arc(
          (event.position.x + 0.5) * cellWidth,
          (event.position.y + 0.5) * cellHeight,
          transient ? (0.3 + 0.5 * progress) * span : 0.45 * span,
          0,
          Math.PI * 2,
        );
        context.stroke();
      } else if (event.type === "bullets-cancelled") {
        context.globalAlpha = markAlpha;
        context.strokeStyle = TANK_PALETTE.bullet;
        context.lineWidth = Math.max(1.5, span * 0.06);
        context.beginPath();
        context.arc(
          (event.position.x + 0.5) * cellWidth,
          (event.position.y + 0.5) * cellHeight,
          0.3 * span,
          0,
          Math.PI * 2,
        );
        context.stroke();
      }
    }
    context.globalAlpha = 1;
  }
  if (animation !== undefined) {
    for (const playerId of animation.erroredPlayers) {
      // The badge follows the drawn tank; a tank destroyed this tick falls back to its
      // last position in the previous world.
      const drawn = tankPoints.get(playerId);
      const fallback = animation.previousState.tanks.find((tank) => tank.id === playerId)?.position;
      const point =
        drawn ?? (fallback ? { x: fallback.x * cellWidth, y: fallback.y * cellHeight } : null);
      if (!point) continue;
      const radius = span * 0.24;
      const center = { x: point.x + cellWidth - radius, y: point.y + radius };
      context.globalAlpha = 1;
      context.fillStyle = TANK_PALETTE.warning;
      context.beginPath();
      context.arc(center.x, center.y, radius, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = TANK_PALETTE.warningInk;
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
