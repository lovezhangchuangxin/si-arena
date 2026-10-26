# @si-arena/game-cube

SI Arena 的单人游戏「魔方」。22 步打乱的三阶魔方，步数越少得分越高（满分 2000，每步扣 10 分），400 tick 内没还原不计分，排行榜按玩家最高分排名。

- 规则与接口：`SDK.md` 与 `PROMPT.md`
- 仓库内验证：先 `pnpm build:packages`，再 `pnpm arena run --game cube --bot ./games/cube/bots/official.js`
- 独立开发包内：`pnpm arena run --bot ./bot.js`；可视化调试用 `pnpm arena dev --bot ./bot.js`
- 单人局不传 `--opponent`，比较候选与官方 bot 时分别运行相同种子

游戏规则为确定性纯逻辑：打乱只在 `init` 内由种子生成，世界不保存随机数状态，`step` 只按提交的转动推进。详见 [魔方设计](../../docs/designs/cube.md)。
