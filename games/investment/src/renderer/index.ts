import type { GameCatalogEntry } from "@si-arena/protocol";

export { INVESTMENT_PALETTE } from "./palette";

export {
  drawInvestmentBoard,
  investmentPlayerSummaries,
  type InvestmentBoardAnimation,
} from "./board";
export { investmentHighlights } from "./highlights";

export const INVESTMENT_ASPECT_RATIO = 16 / 9;

export const investmentPresentation = {
  id: "investment",
  headline: "牛熊之间，追高净值",
  instructions: Object.freeze([
    "最多四名交易者同场，初始现金各 100 万元，在四种风险各异的资产间买卖：锚石稳、恒梁慢、星火快、彗星最野。",
    "市场情绪在牛市、震荡、熊市间切换，共同推动全部资产；每资产还会随机出现利好或利空新闻，造成跳空。",
    "买单按当前价成交并收 0.3% 手续费，现金不足会被拒单；卖出收同样的手续费。现金每 tick 有 0.02% 利息。",
    "大额订单会推动价格：净买入资金越多，下一 tick 价格越被推高（每资产每 tick 最多 ±10%）——追涨杀跌都在给市场让利。",
    "240 tick 收盘，按净资产（现金 + 持仓市值）排名，最高者获胜；需要更长价格历史的策略请用 Memory 自记。",
  ]),
  getStats(game: GameCatalogEntry) {
    return [
      { label: "席位数", value: `${game.minPlayers}-${game.maxPlayers}` },
      { label: "资产数", value: "4" },
      { label: "回合上限", value: String(game.maxTicks) },
      { label: "每 tick CPU", value: `${game.resolvedLimits.cpuMs} ms` },
    ];
  },
};
