import type { DeepReadonly } from "@si-arena/protocol";
import type { DanmakuEvent, DanmakuState } from "../sdk";
import { DANMAKU_CONFIG, danmakuBulletDelta } from "../constants";
import { DANMAKU_PALETTE } from "./palette";

/**
 * 一帧的瞬态演示输入。世界本身永远画自 `state`；事件只补充插值位移、
 * 命中闪光与错误徽标。
 */
export interface DanmakuBoardAnimation {
  previousState: DeepReadonly<DanmakuState>;
  events: DeepReadonly<DanmakuEvent[]>;
  /** 当前 tick 动画窗口的进度 0..1；1（或缺省）画稳定局面。 */
  progress: number;
  reducedMotion: boolean;
  /** 在产生当前世界的输入 tick 上执行出错的玩家 id。 */
  erroredPlayers: ReadonlySet<string>;
}

export function danmakuPlayerSummaries(state: DeepReadonly<DanmakuState>) {
  return state.ships.map((ship) => ({
    id: ship.id,
    label: `P${ship.slot + 1}`,
    color: DANMAKU_PALETTE.players[ship.slot]!,
    score: ship.hp,
    alive: ship.hp > 0,
  }));
}

type Point = { x: number; y: number };

/** 画权威坐标状态；渲染绝不修改或推进规则。 */
export function drawDanmakuBoard(
  context: CanvasRenderingContext2D,
  state: DeepReadonly<DanmakuState>,
  width: number,
  height: number,
  animation?: DanmakuBoardAnimation,
): void {
  const cellWidth = width / state.width;
  const cellHeight = height / state.height;
  const progress = animation === undefined ? 1 : Math.min(1, Math.max(0, animation.progress));
  const reducedMotion = animation?.reducedMotion ?? false;
  const transient = !reducedMotion && progress < 1 && animation !== undefined;
  const events = animation?.events ?? [];
  const markAlpha = transient ? 1 - progress : 0;

  context.fillStyle = DANMAKU_PALETTE.background;
  context.fillRect(0, 0, width, height);

  // 网格参考线。
  context.strokeStyle = DANMAKU_PALETTE.grid;
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

  // 移动插值：从上一状态的位置滑向当前位置。
  const moves = new Map<string, { from: Point; to: Point }>();
  if (transient) {
    const previous = animation!.previousState;
    for (const event of events) {
      if (event.type !== "move") continue;
      const origin = previous.ships.find((vessel) => vessel.id === event.playerId)?.position;
      const ship = state.ships.find((vessel) => vessel.id === event.playerId);
      if (!origin || !ship) continue;
      moves.set(event.playerId, { from: { ...origin }, to: { ...ship.position } });
    }
  }

  // 弹幕：飞行插值 = 用规则同款位移函数反推上一 tick 起点；
  // 慢弹画小一号，与快弹在视觉上区分。
  for (const bullet of state.bullets) {
    const [dx, dy] = danmakuBulletDelta(bullet.direction, bullet.speed);
    const x = transient ? bullet.position.x - dx * (1 - progress) : bullet.position.x;
    const y = transient ? bullet.position.y - dy * (1 - progress) : bullet.position.y;
    context.fillStyle = DANMAKU_PALETTE.bullets[bullet.owner]!;
    context.beginPath();
    context.arc(
      (x + 0.5) * cellWidth,
      (y + 0.5) * cellHeight,
      Math.min(cellWidth, cellHeight) * (bullet.speed === "slow" ? 0.16 : 0.22),
      0,
      Math.PI * 2,
    );
    context.fill();
  }

  // 机体：带描边圆点 + HP 环，速度箭头指示漂移方向。
  for (const ship of state.ships) {
    const move = transient ? moves.get(ship.id) : undefined;
    const from = move?.from ?? ship.position;
    const to = ship.position;
    const x = from.x + (to.x - from.x) * progress;
    const y = from.y + (to.y - from.y) * progress;
    const cx = (x + 0.5) * cellWidth;
    const cy = (y + 0.5) * cellHeight;
    const radius = Math.min(cellWidth, cellHeight) * 0.38;
    context.fillStyle = DANMAKU_PALETTE.players[ship.slot]!;
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = DANMAKU_PALETTE.background;
    context.lineWidth = Math.max(1, radius * 0.18);
    context.stroke();
    // HP 环：满血为整环。
    const hp = Math.max(0, ship.hp) / DANMAKU_CONFIG.initialHp;
    context.strokeStyle = DANMAKU_PALETTE.text;
    context.lineWidth = Math.max(1, radius * 0.22);
    context.beginPath();
    context.arc(cx, cy, radius * 1.35, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hp);
    context.stroke();
    // 惯性箭头：速度非零时指向漂移方向。
    if (ship.velocity.x !== 0 || ship.velocity.y !== 0) {
      const magnitude =
        Math.min(cellWidth, cellHeight) *
        (0.55 + 0.35 * Math.max(Math.abs(ship.velocity.x), Math.abs(ship.velocity.y)));
      const angle = Math.atan2(ship.velocity.y, ship.velocity.x);
      context.strokeStyle = DANMAKU_PALETTE.text;
      context.lineWidth = Math.max(1, radius * 0.2);
      context.beginPath();
      context.moveTo(cx + Math.cos(angle) * radius * 1.5, cy + Math.sin(angle) * radius * 1.5);
      context.lineTo(cx + Math.cos(angle) * magnitude, cy + Math.sin(angle) * magnitude);
      context.stroke();
    }
    if (transient && animation!.erroredPlayers.has(ship.id)) {
      context.strokeStyle = DANMAKU_PALETTE.hit;
      context.lineWidth = Math.max(1.5, radius * 0.25);
      context.beginPath();
      context.arc(cx, cy, radius * 1.7, 0, Math.PI * 2);
      context.stroke();
    }
  }

  // 本 tick 命中闪光。
  if (transient) {
    context.globalAlpha = 0.6 * markAlpha;
    context.fillStyle = DANMAKU_PALETTE.hit;
    for (const event of events) {
      if (event.type !== "hit" && event.type !== "destroyed") continue;
      context.beginPath();
      context.arc(
        (event.position.x + 0.5) * cellWidth,
        (event.position.y + 0.5) * cellHeight,
        Math.min(cellWidth, cellHeight) * 0.8,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
    context.globalAlpha = 1;
  }
}
