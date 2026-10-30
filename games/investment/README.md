# @si-arena/game-investment

模拟投资游戏包：最多四名交易者同场，在牛熊交替的市场里买卖四种风险各异的资产（锚石/恒梁/星火/彗星），新闻跳空、现金利息与手续费之间追高净资产，240 tick 收盘时净值最高者获胜。大额订单的净资金流会推动下一 tick 价格（每资产每 tick 最多 ±10%）。规则与 SDK 入口不依赖 Vue、数据库或平台账号。完整玩法见 [模拟投资设计](../../docs/designs/investment.md)。

- `src/manifest.ts`：游戏元数据、固定配置与解析后的默认资源预算；四席竞技场。
- `src/constants.ts`：资产参数表（价格、漂移、噪声、新闻冲击、敏感度、深度）、regime 转移表、手续费/利息/影响限额与万分比定点运算。
- `src/sdk/`：玩家观察、状态、动作与 SDK 类型，以及可信运行时 SDK 源码。
- `src/game.ts`：可信游戏定义、配置、世界与观察身份校验、官方 bot 资源位置。
- `src/rules/`：观察、动作校验、同时结算（撮合、利息、regime/新闻/影响定价）与终局判定。
- `src/renderer/`：规则页展示数据、深色金融配色（红涨绿跌）、Canvas 市场面板（价格方向箭头、自开盘涨跌、走势填充、持仓筹码、全程净值曲线与播报）。
- `bots/`：官方 bot 与玩家模板。
- `PROMPT.md`、`SDK.md` 与 `bots/template.js`：统一参赛提示词、接口说明和玩家模板，供网页及独立开发包共用。
- `tests/`：规则、契约、确定性、完整对局重演、真实沙箱对局与 renderer 测试。

## 公开入口

| 入口                                 | 内容                                                                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `@si-arena/game-investment`          | `investmentManifest`、`investmentCatalogEntry`、`INVESTMENT_ASSETS` 与基础状态类型                                                       |
| `@si-arena/game-investment/sdk`      | `InvestmentAction`、`InvestmentObservation`、`InvestmentState`、`InvestmentTickInput` 等类型、资产/regime 常量与 `INVESTMENT_SDK_SOURCE` |
| `@si-arena/game-investment/rules`    | `investmentRules`、`parseInvestmentAction`、`parseInvestmentState`、`parseInvestmentObservation`、`netWorth` 及事件、结果类型            |
| `@si-arena/game-investment/renderer` | `drawInvestmentBoard`、`investmentPlayerSummaries`、`investmentHighlights`、`INVESTMENT_PALETTE`、`investmentPresentation`               |
| `@si-arena/game-investment/game`     | `investmentGame`、`INVESTMENT_SDK_SOURCE`、`officialBotUrl`、`developmentFiles`                                                          |
