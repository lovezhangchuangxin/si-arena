import type { DeepReadonly } from "@si-arena/protocol";
import { INVESTMENT_ASSET_IDS, INVESTMENT_ASSETS, INVESTMENT_CONFIG } from "../constants";
import type { InvestmentEvent, InvestmentState } from "../sdk";
import { netWorth } from "../rules/observation";
import { INVESTMENT_PALETTE as PALETTE } from "./palette";

/**
 * 一帧的瞬态演示输入。世界永远画自 `state`；事件只补充成交闪烁
 * 与错误徽标。投资棋盘没有位移插值，progress 只控制闪烁衰减。
 */
export interface InvestmentBoardAnimation {
  events: DeepReadonly<InvestmentEvent[]>;
  /** 当前 tick 动画窗口的进度 0..1；1（或缺省）画稳定局面。 */
  progress: number;
  reducedMotion: boolean;
  /** 在产生当前世界的输入 tick 上执行出错的玩家 id。 */
  erroredPlayers: ReadonlySet<string>;
}

export function investmentPlayerSummaries(state: DeepReadonly<InvestmentState>) {
  return state.traders.map((trader) => {
    const worth = netWorth(state, trader.slot);
    const gain = worth - INVESTMENT_CONFIG.initialCash;
    return {
      id: trader.id,
      label: `P${trader.slot + 1}`,
      color: PALETTE.players[trader.slot]!,
      score: worth,
      alive: true,
      detail: `${gain >= 0 ? "+" : ""}${gain.toLocaleString("en-US")}`,
    };
  });
}

const formatYuan = (value: number) => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
};

const MONO = `"JetBrains Mono", monospace`;

/** 画权威市场状态；渲染绝不修改或推进规则。 */
export function drawInvestmentBoard(
  context: CanvasRenderingContext2D,
  state: DeepReadonly<InvestmentState>,
  width: number,
  height: number,
  animation?: InvestmentBoardAnimation,
): void {
  const progress = animation === undefined ? 1 : Math.min(1, Math.max(0, animation.progress));
  const events = animation?.events ?? [];

  context.fillStyle = PALETTE.background;
  context.fillRect(0, 0, width, height);

  const columns = INVESTMENT_ASSET_IDS.length;
  const padding = Math.max(8, width * 0.02);
  const gap = padding;
  const columnWidth = (width - padding * 2 - gap * (columns - 1)) / columns;

  // 顶部信息条。
  const headerHeight = Math.max(24, height * 0.08);
  context.fillStyle = PALETTE.text;
  context.font = `${Math.max(10, height * 0.035)}px ${MONO}`;
  context.textBaseline = "middle";
  const regimeLabel = state.regime === "bull" ? "牛市" : state.regime === "bear" ? "熊市" : "震荡";
  const regimeColor =
    state.regime === "bull" ? PALETTE.up : state.regime === "bear" ? PALETTE.down : PALETTE.flat;
  context.textAlign = "left";
  context.fillStyle = PALETTE.dim;
  context.fillText(`Tick ${state.tick}/${state.maxTicks}`, padding, headerHeight / 2);
  context.textAlign = "right";
  context.fillStyle = regimeColor;
  context.fillText(`市场情绪：${regimeLabel}`, width - padding, headerHeight / 2);

  // 布局：资产列在上，净值曲线在下。
  const chartPanelHeight = Math.max(64, height * 0.26);
  const boardTop = headerHeight + gap;
  const boardHeight = height - boardTop - chartPanelHeight - gap * 2 - padding;
  for (let index = 0; index < columns; index++) {
    const spec = INVESTMENT_ASSETS[index]!;
    const x = padding + index * (columnWidth + gap);
    const history = state.history[index]!;
    const price = state.prices[index]!;
    const previous = history.length > 1 ? history[history.length - 2]! : price;
    const changeBps = previous === 0 ? 0 : Math.round(((price - previous) / previous) * 10_000);
    const open = history[0]!;
    const totalBps = open === 0 ? 0 : Math.round(((price - open) / open) * 10_000);
    const trendUp = price > previous;
    const trendDown = price < previous;
    const color = trendUp ? PALETTE.up : trendDown ? PALETTE.down : PALETTE.flat;

    // 列背景。
    context.fillStyle = "rgba(31, 41, 55, 0.35)";
    context.fillRect(x, boardTop, columnWidth, boardHeight);

    // 列标题与新闻角标。
    const titleSize = Math.max(10, Math.min(columnWidth * 0.12, height * 0.035));
    context.font = `${titleSize}px ${MONO}`;
    context.textAlign = "left";
    context.fillStyle = PALETTE.text;
    context.fillText(spec.name, x + padding * 0.5, boardTop + titleSize);

    const assetNews = state.news.find((news) => news.asset === spec.id);
    if (assetNews) {
      context.fillStyle = assetNews.positive ? PALETTE.up : PALETTE.down;
      context.textAlign = "right";
      context.fillText(
        assetNews.positive ? "▲新闻" : "▼新闻",
        x + columnWidth - padding * 0.5,
        boardTop + titleSize,
      );
    }

    // 当前价（带涨跌方向箭头）与两个涨跌幅。
    const priceSize = Math.max(14, Math.min(columnWidth * 0.2, height * 0.06));
    context.font = `bold ${priceSize}px ${MONO}`;
    context.fillStyle = color;
    context.textAlign = "left";
    const arrow = trendUp ? "▲" : trendDown ? "▼" : "—";
    context.fillText(
      `${arrow}${price.toLocaleString("en-US")}`,
      x + padding * 0.5,
      boardTop + titleSize * 2 + priceSize * 0.7,
    );
    context.font = `${titleSize}px ${MONO}`;
    context.fillText(
      `${changeBps >= 0 ? "+" : ""}${(changeBps / 100).toFixed(2)}%`,
      x + padding * 0.5,
      boardTop + titleSize * 2 + priceSize * 1.4,
    );
    // 自开盘的累计涨跌（次行，灰色小字）。
    context.fillStyle = totalBps >= 0 ? PALETTE.up : PALETTE.down;
    context.fillText(
      `自开盘 ${totalBps >= 0 ? "+" : ""}${(totalBps / 100).toFixed(2)}%`,
      x + padding * 0.5,
      boardTop + titleSize * 2 + priceSize * 1.4 + titleSize * 1.2,
    );

    // 迷你走势线（最近历史价）+ 淡色填充。
    const chartTop = boardTop + titleSize * 2 + priceSize * 1.8 + titleSize * 1.2;
    const chartHeight = Math.max(10, boardHeight - (chartTop - boardTop) - padding);
    const low = Math.min(...history);
    const high = Math.max(...history);
    const span = high - low || 1;
    context.strokeStyle = PALETTE.grid;
    context.lineWidth = 0.5;
    for (let line = 1; line < 4; line++) {
      const y = chartTop + (chartHeight * line) / 4;
      context.beginPath();
      context.moveTo(x + padding * 0.5, y);
      context.lineTo(x + columnWidth - padding * 0.5, y);
      context.stroke();
    }
    const pointX = (at: number) =>
      x + padding * 0.5 + ((columnWidth - padding) * at) / Math.max(1, history.length - 1);
    const pointY = (value: number) => chartTop + chartHeight - ((value - low) / span) * chartHeight;
    // 填充：收盘序列折线到基线的区域，透明度按走势方向。
    context.globalAlpha = 0.12;
    context.fillStyle = color;
    context.beginPath();
    history.forEach((value, at) => {
      const px = pointX(at);
      const py = pointY(value);
      if (at === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    });
    context.lineTo(pointX(history.length - 1), chartTop + chartHeight);
    context.lineTo(pointX(0), chartTop + chartHeight);
    context.closePath();
    context.fill();
    context.globalAlpha = 1;
    context.strokeStyle = color;
    context.lineWidth = Math.max(1.5, width * 0.004);
    context.beginPath();
    history.forEach((value, at) => {
      const px = pointX(at);
      const py = pointY(value);
      if (at === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    });
    context.stroke();

    // 本 tick 在该资产上的成交闪烁（买在下、卖在上，玩家色）。
    if (progress < 1) {
      const trades = events.filter(
        (event) => event.type === "trade" && event.asset === spec.id,
      ) as DeepReadonly<Extract<InvestmentEvent, { type: "trade" }>>[];
      for (const trade of trades) {
        const trader = state.traders.find((candidate) => candidate.id === trade.playerId);
        if (trader === undefined) continue;
        context.globalAlpha = 1 - progress;
        context.fillStyle = PALETTE.players[trader.slot]!;
        const dotSize = Math.max(4, columnWidth * 0.06);
        context.beginPath();
        context.arc(
          x + columnWidth / 2,
          chartTop + chartHeight * (trade.side === "buy" ? 0.75 : 0.25),
          dotSize,
          0,
          Math.PI * 2,
        );
        context.fill();
        context.globalAlpha = 0.3 * (1 - progress);
        context.fillStyle = PALETTE.players[trader.slot]!;
        context.fillRect(x, boardTop, columnWidth, boardHeight);
        context.globalAlpha = 1;
      }
    }
  }

  // ── 持仓筹码区：每资产下谁持有多少市值（按玩家色分段堆叠）────
  const chipsTop = boardTop + boardHeight + gap;
  const chipsHeight = Math.max(14, height * 0.05);
  for (let index = 0; index < columns; index++) {
    const x = padding + index * (columnWidth + gap);
    const holdings = state.traders.map((trader) => trader.shares[index]! * state.prices[index]!);
    const total = holdings.reduce((sum, value) => sum + value, 0);
    let chipX = x;
    const chipMaxWidth = columnWidth;
    if (total === 0) {
      context.fillStyle = PALETTE.grid;
      context.fillRect(x, chipsTop, chipMaxWidth, chipsHeight);
    } else {
      for (let slot = 0; slot < holdings.length; slot++) {
        const value = holdings[slot]!;
        const share = value / total;
        const segWidth = Math.max(2, chipMaxWidth * share);
        context.fillStyle = PALETTE.players[slot]!;
        context.fillRect(chipX, chipsTop, segWidth - 1, chipsHeight);
        chipX += segWidth;
      }
    }
  }

  // ── 底部净值曲线：全程净值走势 + 初始资金基准线 + 领先者标记 ─
  const footerTop = chipsTop + chipsHeight + gap;
  const footerHeight = height - footerTop - padding;
  const footerLeft = padding;
  const footerRight = width - padding;
  drawWorthChart(context, state, footerLeft, footerTop, footerRight - footerLeft, footerHeight);

  // 错误徽标（居中，不与进度/情绪文字重叠）。
  if (animation !== undefined && animation.erroredPlayers.size > 0) {
    context.fillStyle = PALETTE.danger;
    context.textAlign = "center";
    context.fillText(`⚠ ${[...animation.erroredPlayers].join(", ")}`, width / 2, headerHeight / 2);
  }
}

/** 全程净值曲线：人人可见的领跑变换与翻车现场。 */
function drawWorthChart(
  context: CanvasRenderingContext2D,
  state: DeepReadonly<InvestmentState>,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  if (width <= 4 || height <= 4) return;
  context.fillStyle = "rgba(31, 41, 55, 0.35)";
  context.fillRect(left, top, width, height);

  const font = Math.max(9, Math.min(width * 0.02, height * 0.3));
  context.font = `${font}px ${MONO}`;
  context.textBaseline = "middle";

  // 全体净值范围（含初始资金基准线）。
  const initial = INVESTMENT_CONFIG.initialCash;
  const allValues = state.worthHistory.flat();
  let low = Math.min(...allValues, initial);
  let high = Math.max(...allValues, initial);
  if (high - low < initial * 0.02) {
    // 早期所有序列几乎重合：给基准线留出可见空间。
    const middle = (high + low) / 2;
    low = middle - initial * 0.01;
    high = middle + initial * 0.01;
  }
  const span = high - low || 1;
  const x = (at: number) => left + (width * at) / Math.max(1, state.maxTicks);
  const y = (value: number) => top + height - ((value - low) / span) * height;

  // 初始资金基准虚线（半透明黄）。
  context.save();
  context.strokeStyle = PALETTE.cash;
  context.globalAlpha = 0.55;
  context.setLineDash([4, 3]);
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(left, y(initial));
  context.lineTo(left + width, y(initial));
  context.stroke();
  context.restore();

  // 初始资金标签。
  context.fillStyle = PALETTE.cash;
  context.textAlign = "left";
  context.globalAlpha = 0.8;
  context.fillText(`${formatYuan(initial)}`, left + 4, y(initial) - font * 0.7);
  context.globalAlpha = 1;

  // 每位交易者一条净值曲线（玩家色，线宽随名次递减，领先者最粗）。
  const finalWorths = state.worthHistory.map((series) => series.at(-1)!);
  const rankOf = (slot: number) => finalWorths.filter((worth) => worth > finalWorths[slot]!).length;
  for (const trader of state.traders) {
    const series = state.worthHistory[trader.slot]!;
    context.strokeStyle = PALETTE.players[trader.slot]!;
    context.lineWidth = Math.max(1.2, 3.2 - rankOf(trader.slot) * 0.7);
    context.beginPath();
    series.forEach((worth, at) => {
      const px = x(at);
      const py = y(worth);
      if (at === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    });
    context.stroke();
    // 末端点与净值标签（领先者加粗；纵向错位避免早期重叠）。
    const isLeader = rankOf(trader.slot) === 0;
    context.fillStyle = PALETTE.players[trader.slot]!;
    context.beginPath();
    context.arc(x(series.length - 1), y(series.at(-1)!), Math.max(2, font * 0.35), 0, Math.PI * 2);
    context.fill();
    context.textAlign = "right";
    context.font = `${isLeader ? "bold " : ""}${font}px ${MONO}`;
    context.fillText(
      `P${trader.slot + 1} ${formatYuan(series.at(-1)!)}`,
      left + width - 4,
      Math.min(
        top + font,
        Math.max(top + height - 2, y(series.at(-1)!) - font * (0.8 + trader.slot * 0.9)),
      ),
    );
  }
}
