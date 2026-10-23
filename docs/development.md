# 仓库开发指南

面向修改 SI Arena 平台、游戏和工具的维护者。玩家编写 bot 使用服务器开发包中的 README、PROMPT 和 SDK，无需克隆仓库。本文命令均从仓库根目录执行；生产环境见 [部署与发布](architecture/deployment.md)。

## 环境与首次启动

使用 Node.js 26、pnpm 12 和 TypeScript ESM。pnpm 按根 `package.json` 的 `packageManager` 切换精确版本，不使用 corepack。需要完整网站参赛流程时，准备 Docker Compose 启动 PostgreSQL。

```sh
pnpm install
if [ ! -e .env ]; then cp .env.example .env; fi
docker compose -f deploy/compose.yaml up -d --wait db
```

示例数据库监听 `127.0.0.1:5433`，连接配置见 [.env.example](../.env.example)。先确认 `.env` 中的 `DATABASE_URL` 指向此次开发使用的数据库，再迁移并启动：

```sh
pnpm db:migrate
pnpm dev
```

已有 `.env` 不应覆盖。迁移会修改目标数据库结构；不要用生产连接做开发验证。

`pnpm dev` 先构建共享包，再并行启动网站、API、worker 与各包的开发监视。网站为 [http://127.0.0.1:5173](http://127.0.0.1:5173)，API 为 [http://127.0.0.1:3000](http://127.0.0.1:3000)。Vite 代理 `/api` 与 `/health`。

server 启动时安装各游戏官方 bot；`BOSSES_DIR` 中的私有源码用于支持 Boss 挑战的游戏。worker 领取用户已创建的任务。`/health` 仅表示 HTTP 服务存活，不能证明数据库或 worker 已就绪。

## 按任务启动

| 任务                   | 命令                  | 依赖                               |
| ---------------------- | --------------------- | ---------------------------------- |
| 网站、API、worker 联调 | `pnpm dev`            | 数据库已迁移                       |
| 单独启动网站           | `pnpm dev:web`        | 参赛功能需要另启 API 与 worker     |
| 单独启动 API           | `pnpm dev:server`     | 认证与参赛需要数据库               |
| 单独启动 worker        | `pnpm dev:worker`     | 数据库与已创建任务                 |
| 构建共享包与游戏       | `pnpm build:packages` | 无需数据库                         |
| 全量生产构建           | `pnpm build`          | 无需数据库                         |
| 生成数据库迁移         | `pnpm db:generate`    | 修改 Drizzle schema 后检查生成差异 |
| 应用数据库迁移         | `pnpm db:migrate`     | 明确的目标数据库                   |

只调试规则、沙箱或 bot 时，无需启动平台服务：

```sh
pnpm build:packages
pnpm arena run --game paper --bot ./games/paper/bots/official.js --seed 42
pnpm arena run --game tetris --bot ./games/tetris/bots/official.js --seed 42
pnpm arena replay --game paper ./replays/实际文件名.json.gz --verify --logs
```

把回放路径替换为比赛输出的实际路径。根 [注册配置](../configs/arena.local.mjs) 包含多个游戏，需指定 `--game`；独立开发包只包含一个游戏，无需该参数。仓库内回放使用 `--verify` 做终端校验，图形查看可使用网站 `/replays`；`arena dev` 和 CLI 图形回放依赖独立开发包中的 viewer。更多选项见 [CLI README](../packages/cli/README.md)。

## 构建与验证开发包

```sh
pnpm build:devkits
# 或只生成一个游戏
pnpm build:devkits --game tetris
```

构建读取 [configs/devkits.ts](../configs/devkits.ts)，输出到 `data/releases/<gameId>/`。server 的 `DEVKITS_DIR` 必须指向同一目录。API 启动后，可在仓库根下载当前包，再进入生成目录验证：

```sh
pnpm exec arena init paper ./paper-bot --server http://127.0.0.1:3000
cd paper-bot
pnpm install --frozen-lockfile
pnpm arena dev --bot ./bot.js
```

目标目录须为空或不存在。生成目录用于本地验证，不提交到仓库。仅改文档或提示词也要重新构建并部署开发包，网页资料与 ZIP 才会一致；不因此升级游戏发行或玩家协议。完整构建与发布边界见 [分发设计](architecture/distribution-and-development.md)。

server 与 worker 共用 `REPLAYS_DIR`，server 与开发包发布器共用 `DEVKITS_DIR`。这些路径的相对值以仓库根为基准。私有 Boss 源码、回放、开发包、数据库和 `.env` 都不是源码提交内容。

## 验证范围

| 命令                  | 验证内容                                                   | 不代表什么                               |
| --------------------- | ---------------------------------------------------------- | ---------------------------------------- |
| `pnpm test`           | Vitest 全仓源码测试，无需预构建                            | 不替代类型检查；缺少外部环境的测试会跳过 |
| `pnpm typecheck`      | 构建共享依赖，检查源码、测试、配置与 Vue 测试类型          | 不执行测试                               |
| `pnpm check`          | 类型、oxlint、oxfmt、测试                                  | 不包含全量生产构建和完整产物验证         |
| `pnpm test:coverage`  | 源码覆盖率，输出到 `coverage/`                             | 覆盖率不是业务正确性证明                 |
| `pnpm test:artifacts` | 生产构建、仓库外真实 Node 与 NodeNext 消费、独立开发包流程 | 不发布 npm，不连接业务数据库             |

按项目运行，例如 `pnpm test --project paper-rules`；监听模式使用 `pnpm test:watch --project paper-rules`。项目名见各 workspace 的 `vitest.config.ts`。测试映射、配置继承与包边界详见 [模块与构建](architecture/monorepo-and-modules.md)。

### 数据库集成测试

`ARENA_TEST_DATABASE_URL` 必须指向允许创建临时数据库的测试连接。测试自建并清理独立数据库，不在现有业务库里执行用例。以下连接对应仓库的本地 Compose：

```sh
ARENA_TEST_DATABASE_URL=postgresql://si_arena:si_arena@127.0.0.1:5433/si_arena pnpm test --project server --project worker
```

未设置该变量时，数据库集成测试跳过。当前 [CI](../.github/workflows/ci.yml) 执行 `pnpm check`、`pnpm test:artifacts` 和镜像构建，但没有配置 PostgreSQL 测试服务；CI 成功不能视为数据库集成测试通过。

### Linux 进程隔离测试

真实 cgroup 测试需要 Linux 和 `ARENA_TEST_CGROUP_ROOT` 指向已委托目录，见 [runner README](../packages/runner/README.md)。macOS、普通目录或未配置 cgroup 的本地测试不能替代内核资源隔离验证。

### 选择检查

- 文档：核对事实、命令、相对链接、代码块和修改文件的格式。
- 代码：运行受影响测试，交付前执行 `pnpm check`。
- 构建、exports、CLI 或分发机制：另运行 `pnpm test:artifacts`。
- 界面：检查桌面、窄屏、键盘操作及加载、错误、空状态。

报告实际通过、失败和跳过的范围，不把测试跳过写成通过。

## 提交约定

遵循根 [AGENTS.md](../AGENTS.md) 的模块边界和编码约定。使用 workspace 公开 exports、`workspace:*` 与集中 catalog，依赖变更同步生成 lockfile。lint 使用 oxlint，格式化使用 oxfmt。

`pnpm install` 的 prepare 安装 git hooks：pre-commit 对暂存文件执行 lint-staged，commit-msg 检查 Conventional Commits。提交前检查差异与暂存内容，不提交生成的 dist、真实凭据或调试产物。

## 文档维护

| 内容                         | 主维护位置                                         | 其他文档如何引用                       |
| ---------------------------- | -------------------------------------------------- | -------------------------------------- |
| 产品范围、页面与代码更新时点 | [产品设计](designs/product.md)                     | README 保留概览与入口                  |
| 比赛类型、榜单与计分         | [排位设计](designs/ranked.md)                      | 游戏设计补充本游戏选人和特殊规则       |
| 游戏规则与结算顺序           | `docs/designs/<gameId>.md`                         | PROMPT 提供玩家可独立使用的规则摘要    |
| 玩家字段、动作与事件         | `games/<gameId>/SDK.md`                            | PROMPT 保留最小接口和重要陷阱          |
| 资源默认值与执行条件         | [资源限额](architecture/resource-limits.md)        | 玩家读取 `release.json` 的实际值       |
| HTTP、数据与事务约束         | [数据与 API](architecture/data-model-and-api.md)   | 产品文档说明用户行为，避免重复响应结构 |
| 公共研究步骤与预算           | [RESEARCH.md](../packages/development/RESEARCH.md) | 通过现有标记组装进各游戏 PROMPT        |
| 包 API 与操作示例            | 各包 README                                        | 架构文档解释职责与边界                 |

修改契约时同步检查对应实现、测试、SDK、提示词和示例。需要离线使用的玩家资料可以重复必要信息，但公共数值优先引用发行清单，研究步骤只维护一份。

规范描述应满足的行为；操作指南说明当前如何使用；历史研究记录说明某个提交下的结论。实现未满足规范时明确差距，不通过删改要求掩盖问题。历史记录保留测量上下文，失效的源码链接用基线提交与仓库路径标识，避免把旧结论指向已重写的当前文件。
