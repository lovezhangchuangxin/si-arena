import type { TetrisAction, TetrisMoveDirection, TetrisRotationDirection } from "../sdk";

const MOVE_DIRECTIONS = new Set<TetrisMoveDirection>(["left", "right", "down"]);
const ROTATIONS = new Set<TetrisRotationDirection>(["cw", "ccw"]);

/** Parses a submitted action; field errors become player-visible messages. */
export function parseTetrisAction(
  raw: unknown,
): { ok: true; action: TetrisAction } | { ok: false; message: string } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return { ok: false, message: "动作必须是一个对象" };
  const action = raw as Record<string, unknown>;
  const fields = Object.keys(action);
  if (action.type === "idle" || action.type === "drop") {
    if (fields.length !== 1) return { ok: false, message: "该动作不接收其他字段" };
    return { ok: true, action: { type: action.type } };
  }
  if (action.type === "move") {
    if (fields.length !== 2 || !MOVE_DIRECTIONS.has(action.direction as TetrisMoveDirection))
      return { ok: false, message: "move 的 direction 必须是 left、right 或 down" };
    return {
      ok: true,
      action: { type: "move", direction: action.direction as TetrisMoveDirection },
    };
  }
  if (action.type === "rotate") {
    if (fields.length !== 2 || !ROTATIONS.has(action.rotation as TetrisRotationDirection))
      return { ok: false, message: "rotate 的 rotation 必须是 cw 或 ccw" };
    return {
      ok: true,
      action: { type: "rotate", rotation: action.rotation as TetrisRotationDirection },
    };
  }
  return { ok: false, message: "未知动作类型" };
}

export const tetrisDefaultAction = (): TetrisAction => ({ type: "idle" });
