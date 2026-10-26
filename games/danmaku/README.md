# @si-arena/game-danmaku

弹幕对决游戏包：两架机体在 32×24 的对称战场上 1v1 惯性机动，每 tick 以加速度走位并可朝 16 个方向发射快慢两档弹幕（每 tick 2 格 / 4 格，均严过机体满速），命中判定 1 格切比雪夫半径，100 点生命先清零者负。出生点由 seed 从中心对称布局表抽取。规则与 SDK 入口不依赖 Vue、数据库或平台账号。完整玩法见 [弹幕对决设计](../../docs/designs/danmaku.md)。

- `src/manifest.ts`：游戏元数据、固定配置与解析后的默认资源预算；本游戏没有竞技场，走 1v1 排位。
- `src/constants.ts`：战场尺寸、tick 上限、9 值加速度输入（8 向 + hold）、16 向弹幕基准位移表、快慢弹步长与 seed 布局表。
- `src/sdk/`：玩家观察、状态、动作与 SDK 类型，以及可信运行时 SDK 源码。
- `src/game.ts`：可信游戏定义、配置、世界与观察身份校验、官方 bot 资源位置。
- `src/rules/`：观察、动作校验、同时结算（惯性移动、开火、弹幕飞行与逐格命中、清理）与终局判定。
- `src/renderer/`：规则页展示数据、深色配色、Canvas 战场绘制（速度箭头与弹速大小区分）与玩家生命摘要，独立 export 入口。
- `bots/`：官方 bot 与玩家模板。
- `PROMPT.md`、`SDK.md` 与 `bots/template.js`：统一参赛提示词、接口说明和玩家模板，供网页及独立开发包共用。
- `tests/`：规则、契约、确定性、完整对局重演、真实沙箱对局与 renderer 测试。

## 公开入口

| 入口                              | 内容                                                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `@si-arena/game-danmaku`          | `danmakuManifest`、`danmakuCatalogEntry`、`DANMAKU_LAYOUTS` 与基础状态类型                                             |
| `@si-arena/game-danmaku/sdk`      | `DanmakuAction`、`DanmakuObservation`、`DanmakuState`、`DanmakuTickInput` 等类型、布局/弹速常量与 `DANMAKU_SDK_SOURCE` |
| `@si-arena/game-danmaku/rules`    | `danmakuRules`、`parseDanmakuAction`、`parseDanmakuState`、`parseDanmakuObservation` 及事件、结果类型                  |
| `@si-arena/game-danmaku/renderer` | `drawDanmakuBoard`、`danmakuPlayerSummaries`、`danmakuHighlights`、`DANMAKU_PALETTE`、`danmakuPresentation`            |
| `@si-arena/game-danmaku/game`     | `danmakuGame`、`DANMAKU_SDK_SOURCE`、`officialBotUrl`、`developmentFiles`                                              |

`drawDanmakuBoard` 接收已验证的世界与 Canvas 上下文，在深色底上绘制网格、带生命环与速度箭头的机体圆点、按所有者配色并按弹速区分大小的弹幕；可选的动画输入与其他格子游戏相同（`previousState`、`events`、`progress`、`reducedMotion`、`erroredPlayers`），补完移动插值、弹幕飞行动画、命中闪光以及出错玩家的警示环。`danmakuPlayerSummaries` 输出双方生命摘要，`danmakuHighlights` 把命中与击毁事件转成播报行。
