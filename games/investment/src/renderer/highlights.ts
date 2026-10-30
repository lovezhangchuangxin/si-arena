import type { DeepReadonly } from "@si-arena/protocol";
import type { InvestmentEvent } from "../sdk";

export type InvestmentHighlightTone = "danger" | "down" | "neutral" | "up";

/** 一条 tick 的播报：成交带金额、新闻带方向与幅度、拒单与利息简报。 */
export function investmentHighlights(
  events: DeepReadonly<InvestmentEvent[]>,
  names: ReadonlyMap<string, string>,
): Array<{ text: string; tone: InvestmentHighlightTone }> {
  const name = (id: string) => names.get(id) ?? id;
  const lines: Array<{ text: string; tone: InvestmentHighlightTone }> = [];
  for (const event of events) {
    if (event.type === "trade")
      lines.push({
        text: `${name(event.playerId)} ${event.side === "buy" ? "买入" : "卖出"} ${event.asset} ×${event.quantity}，金额 ${event.value.toLocaleString("en-US")} 元`,
        tone: "neutral",
      });
    else if (event.type === "rejected")
      lines.push({
        text: `${name(event.playerId)} 的 ${event.asset} ${event.side === "buy" ? "买单" : "卖单"}被拒`,
        tone: "danger",
      });
    else if (event.type === "news") {
      const magnitude = (event.news.magnitudeBps / 100).toFixed(2);
      lines.push(
        event.news.positive
          ? {
              text: `利好新闻：${event.news.asset} +${magnitude}%`,
              tone: "up" as const,
            }
          : {
              text: `利空新闻：${event.news.asset} −${magnitude}%`,
              tone: "down" as const,
            },
      );
    }
  }
  // 利息每 tick 都有，聚合成一条避免刷屏。
  const interestTotal = events.reduce(
    (sum, event) => (event.type === "interest" ? sum + event.amount : sum),
    0,
  );
  if (interestTotal > 0)
    lines.push({
      text: `现金利息共发放 ${interestTotal.toLocaleString("en-US")} 元`,
      tone: "neutral",
    });
  return lines;
}
