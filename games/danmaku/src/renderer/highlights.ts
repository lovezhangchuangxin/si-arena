import type { DeepReadonly } from "@si-arena/protocol";
import type { DanmakuEvent } from "../sdk";

/** 一条 tick 的播报：命中带剩余生命、击毁、开火静默不播。 */
export function danmakuHighlights(
  events: DeepReadonly<DanmakuEvent[]>,
  names: ReadonlyMap<string, string>,
): Array<{ text: string; tone: "danger" | "neutral" }> {
  const name = (id: string) => names.get(id) ?? id;
  const lines: Array<{ text: string; tone: "danger" | "neutral" }> = [];
  for (const event of events) {
    if (event.type === "hit")
      lines.push({
        text: `${name(event.attackerId)} 命中 ${name(event.playerId)}，剩余 ${event.hp} 点生命`,
        tone: "danger",
      });
    else if (event.type === "destroyed")
      lines.push({ text: `${name(event.playerId)} 被弹幕吞没`, tone: "danger" });
  }
  return lines;
}
