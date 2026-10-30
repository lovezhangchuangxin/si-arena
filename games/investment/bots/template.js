/**
 * 模拟投资玩家模板。
 *
 * 每次 tick 会以 `{ game, Memory }` 调用本文件导出的默认函数：
 * - `game.self`：自己的现金、持仓（按资产顺序）、累计手续费与拒单数；
 * - `game.assets`：四种资产的当前价、最近 15 tick 价格与上一 tick 新闻；
 * - `game.traders`：全体交易者的公开现金与持仓；
 * - `game.regime`：当前市场情绪（bull / flat / bear）；
 * - `game.events`：上一 tick 的公开事件；
 * - `Memory`：跨 tick 的 JSON 检查点，直接改写它的字段即可持久化。
 *
 * 通过 `self.buy(asset, quantity)` / `self.sell(asset, quantity)` 提交订单，
 * `self.idle()` 表示本 tick 不交易。必须同步返回 undefined，动作只能通过
 * SDK 方法提交。买单需要现金 ≥ 金额 + 0.3% 手续费，否则被拒单。
 */
export default ({ game, Memory }) => {
  const { self, assets, regime } = game;

  // 示例：按情绪配置目标权重，向目标温和再平衡。替换成你自己的策略。
  if (!Memory.lastWorth) Memory.lastWorth = self.cash;
  const targets =
    regime === "bull"
      ? { anchor: 0.2, beam: 0.3, spark: 0.3, comet: 0.2 }
      : regime === "bear"
        ? { anchor: 0.6, beam: 0.2, spark: 0.1, comet: 0 }
        : { anchor: 0.35, beam: 0.3, spark: 0.25, comet: 0.1 };

  const worth = self.cash + assets.reduce((sum, asset, i) => sum + self.shares[i] * asset.price, 0);

  for (const asset of assets) {
    const targetValue = worth * (targets[asset.id] || 0);
    const currentValue = self.shares[assets.indexOf(asset)] * asset.price;
    const diff = targetValue - currentValue;
    const quantity = Math.floor(Math.abs(diff) / asset.price);
    if (quantity < 1) continue;
    if (diff > 0) {
      const value = quantity * asset.price;
      // 预留手续费：0.3% 向上取整。
      if (self.cash >= value + Math.ceil((value * 30) / 10000)) self.buy(asset.id, quantity);
    } else {
      self.sell(asset.id, Math.min(quantity, self.shares[assets.indexOf(asset)]));
    }
  }
};
