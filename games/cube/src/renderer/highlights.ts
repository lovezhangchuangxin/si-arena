import type { DeepReadonly } from "@si-arena/protocol";
import type { CubeEvent } from "../sdk";

/** Trusted, game-specific wording for one tick's public events; names maps player id to display name. */
export function cubeHighlights(
  events: DeepReadonly<CubeEvent[]>,
  names: ReadonlyMap<string, string>,
): Array<{ text: string; tone: "danger" | "neutral" }> {
  const name = (id: string) => names.get(id) ?? id;
  const lines: Array<{ text: string; tone: "danger" | "neutral" }> = [];
  const solved = events.some((event) => event.type === "solved");
  for (const event of events) {
    if (event.type === "solved")
      lines.push({
        text: `${name(event.playerId)} 用 ${event.moves} 步还原魔方，得分 ${event.score}`,
        tone: "neutral",
      });
    else if (event.type === "turn" && !solved)
      lines.push({
        text: `${name(event.playerId)} ${event.move}（第 ${event.moves} 步）`,
        tone: "neutral",
      });
  }
  return lines;
}
