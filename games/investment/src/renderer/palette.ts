/** 深色金融终端配色（红涨绿跌），与网站既有主题一致。 */
export const INVESTMENT_PALETTE = Object.freeze({
  background: "#0b0e14",
  grid: "rgba(148, 163, 184, 0.14)",
  border: "#1f2937",
  players: Object.freeze(["#38bdf8", "#f97316", "#a3e635", "#e879f9"]),
  /** 上涨与利好：红。 */
  up: "#f87171",
  /** 下跌与利空：绿。 */
  down: "#34d399",
  flat: "#94a3b8",
  /** 执行错误徽标，不与涨跌语义混用。 */
  danger: "#f43f5e",
  cash: "#fbbf24",
  text: "#e2e8f0",
  dim: "#64748b",
} as const);
