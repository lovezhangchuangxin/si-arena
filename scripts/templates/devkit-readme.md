# {{GAME_NAME}} 开发包

游戏发行：{{GAME_RELEASE}}；玩家接口：v{{BOT_PROTOCOL_VERSION}}。配置和资源限制见 [release.json](release.json) 的 `game`。

## 开始使用

需要 Node.js 26+ 与 pnpm 12。在本目录运行：

```sh
pnpm install --frozen-lockfile
pnpm arena run --bot ./bot.js --seed 42
pnpm arena dev --bot ./bot.js
```

`run` 输出比赛结果和回放路径。`dev` 输出本地网址，在浏览器打开即可调试，按 Ctrl+C 停止服务。只指定 `--bot` 时，对抗游戏自动加入官方对手并补满人数；单人游戏只运行自己的代码。

先用初始 [bot.js](bot.js) 确认工具能正常运行，再把 [PROMPT.md](PROMPT.md) 交给编程 AI，按其中的规则和流程改进策略。安装依赖需要网络；安装后，本地比赛、调试和回放都可离线使用，无需账号或数据库，也不影响线上排位。

## 文件说明

| 文件                                                               | 用途                                           |
| ------------------------------------------------------------------ | ---------------------------------------------- |
| [PROMPT.md](PROMPT.md)                                             | 游戏规则、策略思路和实验流程，可交给 AI        |
| [SDK.md](SDK.md)                                                   | 代码入口、动作、字段、事件、Memory 和错误处理  |
| [release.json](release.json)                                       | 本地游戏发行、接口版本、配置和资源限制         |
| [bot.js](bot.js)                                                   | 你要编写、测试并上传的代码                     |
| [bots/official.js](bots/official.js)                               | 官方示例，供阅读和对战，使用相同沙箱与资源限制 |
| [sdk/index.d.ts](sdk/index.d.ts)、[sdk/runtime.js](sdk/runtime.js) | 编辑器类型提示和基础 API 实现                  |
| `arena.mjs`、`vendor/`、`dist/viewer/`、依赖配置                   | 本地工具和配套文件，通过 update 更新           |

先读 PROMPT.md 的规则和结算顺序，再查 SDK.md 和官方源码。所有策略代码都要放在 bot.js 中，运行时不能 import、require 或读取本地文件。SDK.md 中的 JSDoc 类型引用只用于编辑器提示，不会加载模块。

候选代码、实验记录和自定义对手可保存在自行创建的 `research/` 中；回放默认保存在 `replays/`。每场比赛的 Memory 都从空对象开始，跨场记录要保存在本地文件中。

## 批量对战与结果

```sh
pnpm arena run --bot ./bot.js --matches 20 --seed 42
```

以上运行 20 场，使用种子 42–61。对抗游戏可对战已保存的历史版本：

```sh
pnpm arena run --bot ./bot.js --opponent ./research/best-v1.js --matches 20 --seed 42
```

单人游戏不能传 `--opponent`；分别将候选和历史版本作为 `--bot`，用相同种子运行后比较 score。

对抗游戏指定对手后，人数为 1 加上 `--opponent` 的数量。多人游戏可重复传入该参数，人数上限和阵容示例见 PROMPT.md。比赛默认并行运行，可用 `--jobs 1` 改为逐场运行。每批开始时读取源码，运行中修改文件只影响下一批。

输出采用 JSON Lines 格式，每行一个 JSON 对象：

| type          | 内容                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| `release`     | 游戏发行、资源限制 `resolvedLimits` 和玩家列表 `players`                                                    |
| `match`       | 单场种子 `seed`、各玩家的 `id/rank/score`（位于 `result.players`）、错误数 `errorCount` 和回放路径 `replay` |
| `match-error` | 系统失败的场次和原因，应单独统计                                                                            |
| `batch`       | 整批的胜平负、错误数、系统失败场数 `failedMatches` 和回放目录                                               |

`--bot` 对应玩家 ID `bot`，指定的对手依次为 `opponent-1` 等，自动加入的官方对手为 `official-1` 等。交换文件参数后，ID 也会改变，统计时要确认哪个 ID 对应自己的代码。

批量胜负统计针对 `bot`：单独第 1 算胜，并列第 1 算平，其余算负。多人游戏还应比较平均名次，并分别统计单独和并列第 1 的比例。单人游戏 rank 固定为 1，因此 batch 胜率没有区分度，应从每场结果统计平均分、低分局和最高分。`score` 是局内得分，不是 Elo 排位分。

`errorCount` 包含所有玩家的执行错误，可在回放中按玩家 ID 查找。某个玩家出错后，比赛仍可能正常结束，因此命令成功退出不代表每个 tick 都执行成功。先排查错误，再比较策略表现；系统失败的场次也应报告。完整研究流程见 PROMPT.md。

## 调试与回放

修改 bot.js 后，在调试页重新开局。进行中的比赛使用开局时的源码。整场完成后，可逐 tick 查看动作、日志、错误，以及 Memory 修改前后的对比。

将下面的示例路径替换为 `match` 输出中 `replay` 的实际路径：

```sh
pnpm arena replay ./replays/实际文件名.json.gz
pnpm arena replay ./replays/实际文件名.json.gz --verify --logs
```

第一条输出回放页面的网址，按 Ctrl+C 停止服务；第二条在终端校验回放并输出日志和错误。回放不执行 bot，也不保存 Memory；Memory 对比只能在本地调试会话中查看。console 日志按限额记录，线上不收集。

## 更新与上传

```sh
pnpm arena update
pnpm install --frozen-lockfile
```

update 下载服务器最新开发包。CLI 初始化的项目会记住服务器地址；直接解压 ZIP 的项目首次更新需要加 `--server https://<平台地址>`，使用 HTTP 的部署填写实际的 `http://` 地址。旧 CLI 没有 update 命令时，在项目目录运行 `npx @si-arena/cli@latest update --server https://<平台地址>`。

更新会保留 bot.js、research/、回放、自定义对手和其他用户文件。需要替换或删除的平台文件若被你修改过，会先备份到 `.arena-backups/`。更新后要手动执行上面的依赖安装命令。若提示未能完全恢复原文件，请保留并检查命令报告的暂存目录。

更新后先读 SDK 和发行信息，重新测试 bot.js，再到网页上传。需要继续查看旧回放时，请在更新前保留原开发目录，因为新包可能不再支持旧回放。编辑 bot.js 不需要修改 release.json 中的摘要。

网页只上传最终 bot.js，研究记录留在本地。上传会替换当前源码，之后需另行发起比赛。双人排位与多人竞技场按平台规则计算 Elo；双人指定对手练习、官方练习与 Boss 挑战不计排位分，竞技场中的官方席位不产生计分对；单人挑战更新个人最高分。

## 安装排查

- 用 `node --version`、`pnpm --version` 检查版本，在包含 arena.mjs 的目录执行命令。
- 内部组件已放在 `vendor/` 中，无需从 npm 单独安装游戏包或手工替换组件。
- isolated-vm 提供 macOS arm64、Linux x64/arm64 和 Windows x64 的预编译二进制；其他平台需要 C++ 工具链，并在 pnpm-workspace.yaml 的 allowBuilds 中允许编译 isolated-vm。
- 回放提示发行不匹配时，使用保存该回放的原开发目录。
