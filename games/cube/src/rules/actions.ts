import type { CubeAction } from "../sdk";
import { isCubeMove } from "./moves";

/** Parses a submitted action; field errors become player-visible messages. */
export function parseCubeAction(
  raw: unknown,
): { ok: true; action: CubeAction } | { ok: false; message: string } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return { ok: false, message: "动作必须是一个对象" };
  const action = raw as Record<string, unknown>;
  const fields = Object.keys(action);
  if (action.type === "idle") {
    if (fields.length !== 1) return { ok: false, message: "该动作不接收其他字段" };
    return { ok: true, action: { type: "idle" } };
  }
  if (action.type === "move") {
    if (fields.length !== 2 || !isCubeMove(action.move))
      return { ok: false, message: "move 必须是 U、D、L、R、F、B 及其 2 / ' 变体之一" };
    return { ok: true, action: { type: "move", move: action.move } };
  }
  return { ok: false, message: "未知动作类型" };
}

export const cubeDefaultAction = (): CubeAction => ({ type: "idle" });
