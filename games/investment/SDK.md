# 模拟投资玩家 API

本接口 v1（游戏首发）。接口版本与资源限额分别见 `release.json` 的 `game.release`、`game.botProtocolVersion` 与 `game.resolvedLimits`。完整玩法与研究流程见 PROMPT.md。

## 最小可玩

把策略写成一个 UTF-8 JavaScript 文件的 ESM 默认导出函数，每 tick 调用一次。下例在示例期内演示动量买入与现金检查：

```js
/** @param {import("@si-arena/game-investment/sdk").InvestmentTickInput} input */
export default function tick({ game, Memory }) {
  Memory.turns = (typeof Memory.turns === "number" ? Memory.turns : 0) + 1;
  const { self, assets, regime } = game;
  // 熊市持币吃利息，其他情绪按风险递增加权建仓。
  const targets =
    regime === "bear"
      ? { anchor: 0.6, beam: 0.2, spark: 0.1, comet: 0 }
      : { anchor: 0.3, beam: 0.3, spark: 0.25, comet: 0.15 };
  const worth = self.cash + assets.reduce((sum, a, i) => sum + self.shares[i] * a.price, 0);
  for (const asset of assets) {
    const i = assets.indexOf(asset);
    const diff = worth * (targets[asset.id] || 0) - self.shares[i] * asset.price;
    const quantity = Math.floor(Math.abs(diff) / asset.price);
    if (quantity < 1) continue;
    if (diff > 0) {
      const value = quantity * asset.price;
      // 预留 0.3% 手续费（向上取整）。
      if (self.cash >= value + Math.ceil((value * 30) / 10000)) self.buy(asset.id, quantity);
    } else {
      self.sell(asset.id, Math.min(quantity, self.shares[i]));
    }
  }
}
```

必须返回 `undefined`；动作只能通过 `self` 的方法登记。不要返回对象或 Promise，任何返回值都会被判为 `ENTRYPOINT_ERROR`。JSDoc 类型是可选的，不引入模块；运行时禁止动态 import。

## 交易方法

| 方法                         | 说明                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `self.buy(asset, quantity)`  | 提交买单：`asset` 为 `"anchor" "beam" "spark" "comet"` 之一，`quantity` 为 1..1000000 整数。现金不足时整单被拒 |
| `self.sell(asset, quantity)` | 提交卖单：数量超过持仓时整单被拒                                                                               |
| `self.idle()`                | 本 tick 不交易（也是缺省动作）                                                                                 |

同 tick 多次调用以最后一次为准；每 tick 每资产只保留一单。

## 观察字段

| 字段                          | 说明                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `game.tick` / `game.maxTicks` | 当前 tick 与 240 上限                                                                                                 |
| `game.regime`                 | `"bull" \| "flat" \| "bear"` 当前市场情绪                                                                             |
| `game.assets`                 | 固定顺序的四资产数组，每项含 `id`、`name`、`price`、`history`（最近 15 tick，旧→新）、`news`（上一 tick 新闻或 null） |
| `game.traders`                | 全体交易者（含自己）的 `id`、`slot`、`cash`、`shares`（按资产顺序）、`fees`、`rejected`                               |
| `game.self`                   | 自己的现金、持仓、累计手续费与拒单数；`self.netWorth()` 按当前价估值                                                  |
| `game.events`                 | 上一 tick 的公开事件：成交（含金额与手续费）、拒单、利息、新闻                                                        |
| `game.asset(id)`              | 按 id 取资产视图                                                                                                      |
| `Memory`                      | 跨 tick 的 JSON 检查点；执行失败后回退到上次成功值                                                                    |

## 费用与影响

- 手续费：`Math.ceil(名义金额 × 30 / 10000)`，至少 1 元，买卖都收。
- 现金利息：每 tick `Math.ceil(现金 × 2 / 10000)`。
- 市场影响：全市场净买入资金 / 资产深度（anchor 120 万、beam 100 万、spark 80 万、comet 40 万）= 下一 tick 推动幅度，每资产每 tick 钳制 ±10%。下单前预估自己推动的成本。
