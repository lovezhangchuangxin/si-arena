# @si-arena/game-tetris

SI Arena 的单人游戏「俄罗斯方块」。7-bag 发牌、消行计分、每 10 行提速，打满 1500 tick 或堆到顶部结束，排行榜按玩家最高分排名。

- 规则与接口：`SDK.md` 与 `PROMPT.md`
- 仓库内验证：先 `pnpm build:packages`，再 `pnpm arena run --game tetris --bot ./games/tetris/bots/official.js`
- 独立开发包内：`pnpm arena run --bot ./bot.js`；可视化调试用 `pnpm arena dev --bot ./bot.js`
- 单人局不传 `--opponent`，比较候选与官方 bot 时分别运行相同种子

游戏规则为确定性纯逻辑：xorshift32 PRNG 状态随世界保存，`init` 与 `step` 都只消费世界内随机数。详见 [俄罗斯方块设计](../../docs/designs/tetris.md)。
