# @si-arena/game-tetris

SI Arena 的单人游戏「俄罗斯方块」。7-bag 发牌、消行计分、每 10 行提速，打满 1500 tick 或堆到顶部结束，排行榜按玩家最高分排名。

- 规则与接口：`SDK.md` 与 `PROMPT.md`
- 本地对战：`pnpm arena run --bot ./bot.js`（单人局，无需对手）
- 可视化调试：`pnpm arena dev --bot ./bot.js`

游戏规则为确定性纯逻辑：xorshift32 PRNG 状态随世界保存，`init` 与 `step` 都只消费世界内随机数。详见仓库 `docs/designs/tetris.md`。
