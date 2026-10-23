import type { DeepReadonly } from "@si-arena/protocol";
import type { TetrisEvent } from "../sdk";

/** Trusted, game-specific wording for one tick's public events; names maps player id to display name. */
export function tetrisHighlights(
  events: DeepReadonly<TetrisEvent[]>,
  names: ReadonlyMap<string, string>,
): Array<{ text: string; tone: "danger" | "neutral" }> {
  const name = (id: string) => names.get(id) ?? id;
  const lines: Array<{ text: string; tone: "danger" | "neutral" }> = [];
  for (const event of events) {
    if (event.type === "lock" && event.lines === 4)
      lines.push({
        text: `${name(event.playerId)} 打出 TETRIS！四行同消 +${event.gain} 分`,
        tone: "neutral",
      });
    else if (event.type === "lock" && event.lines > 0)
      lines.push({
        text: `${name(event.playerId)} 消掉 ${event.lines} 行，+${event.gain} 分`,
        tone: "neutral",
      });
    else if (event.type === "level-up")
      lines.push({
        text: `${name(event.playerId)} 提速：进入 level ${event.level}`,
        tone: "neutral",
      });
    else if (event.type === "top-out")
      lines.push({ text: `${name(event.playerId)} 新块放不下了，挑战结束`, tone: "danger" });
  }
  return lines;
}
