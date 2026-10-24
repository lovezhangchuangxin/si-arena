# 数据模型与 API

本文定义持久化、比赛生命周期和 HTTP 契约。所有接口统一使用 `/api` 前缀，下文路径均省略此前缀；例如 `/auth/login` 的完整路径为 `/api/auth/login`。客户端共享类型见 [protocol/match.ts](../../packages/protocol/src/match.ts)，类型声明不能替代边界校验。

[数据模型](#数据模型) · [任务与结算](#主动匹配与领取) · [认证](#注册登录与会话) · [参赛状态与上传](#游戏参赛-api) · [创建比赛](#创建比赛-api) · [查询](#查询-api) · [路由索引](#路由索引)

## 数据模型

| 实体                 | 主要字段与约束                                                                                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`              | 用户 ID、唯一规范用户名（即展示名）、密码摘要与参数、官方标记、Boss 标记；两个标记都不可由普通用户修改                                                                                   |
| `sessions`           | 会话 token 的 SHA-256 摘要、用户 ID、创建时间与到期时间                                                                                                                                  |
| `auth_rate_limits`   | 认证限流作用域、主体摘要、窗口开始时间与计数，窗口内原子递增                                                                                                                             |
| `game_entries`       | `(game_id, user_id)` 唯一；最新源码、源码字节数、代码协议版本、更新时间、排位分、比赛数、胜平负计数；竞技场游戏另有名次总和，单人游戏有历史最高分 `bestScore`                            |
| `matches`            | 比赛 ID、游戏及冻结发行、发起者、幂等标识、类型（`ranked`、`practice`、`boss`、`arena`、`solo`）、状态、resolvedLimits、实际配置、种子、租约、执行标识、结果、回放引用、时间戳、失败原因 |
| `match_participants` | `(match_id, user_id)` 唯一；固定席位、创建时用户名与官方、Boss 标记快照、局内名次与得分 `score`、适用时的结算前后排位                                                                    |

首版游戏目录、规则说明和发行清单来自可信游戏包，不必额外建一套数据库 CMS。任务状态放在 `matches`，无需再建一张重复的任务业务表。

`game_entries` 是按游戏独立的参赛身份：同一用户不同游戏的代码与分数不共享。源码仅在这里保存当前值，不建立 `code_versions` 或历史编译产物表。

Memory 是比赛内临时执行数据，不写回 `game_entries`。比赛结束后释放。回放保存到文件存储，数据库保存引用、格式/发行信息、文件大小和校验摘要，不将每 tick 动作拆成海量关系行。

## 上传

1. 验证身份和游戏 ID。
2. 按该游戏当前发行的 `resolvedLimits.codeBytes` 在读取请求时限制字节数，验证 UTF-8、自包含单文件格式与语法。
3. 静态检查默认导出等可检查部分；不能靠执行顶层代码完成检查。
4. 事务内确认当前游戏发行与检查时一致，插入或覆盖最新源码、实际字节数和该发行的 `botProtocolVersion`，保留排位、最高分与累计比赛统计。发行已切换时返回 409，要求刷新游戏信息后重新提交。
5. 返回成功，不创建比赛、不调用游戏试跑。

静态 AST 检查禁止导入、导出转发和顶层 await，同版 V8 仅做模块编译语法校验，不执行用户代码。它不能证明程序必定正常返回函数、动作合法或执行不超限；剩余错误由每 tick 执行协议处理。上传被拒绝时保留原代码。

并发上传按最后成功提交覆盖。worker 开始比赛时用一个一致性快照读取所有参赛者的最新源码、字节数和代码协议版本，使用该比赛创建时已经冻结的游戏发行、配置及 resolvedLimits。之后上传不替换本场代码。短事务只负责读取和检查，不能在整场执行时锁住源码行。

匹配前排除代码协议版本与当前发行不一致或源码超过当前发行限制的选手。代码、SDK 兼容升级不要求重新上传；不兼容升级通过 `botProtocolVersion` 递增识别。旧选手保留排位与历史比赛，页面显示需要重新上传，在完成上传前不能主动匹配或成为对手。

已排队比赛不会自动改为新发行。开局时再次检查最新代码能否用于其冻结发行；代码被新协议或更大源码替换时，本场进入 `failed`，原因 `ENTRY_CHANGED_BEFORE_START`，不执行、不计分，提示重新主动匹配。不能找回旧源码，也不能将新代码放到旧协议里强行执行。

## 主动匹配与领取

创建比赛的路径验证代码协议与大小，在事务中确定参赛者、冻结发行与完整限额，写入参与者及 `pending` 比赛，并用唯一约束限制未完成主动请求。双人游戏选择对手，竞技场选择阵容，单人游戏只加入发起者。不同游戏可以同时存在各自的主动请求。

幂等标识必须与发起用户和请求内容绑定。相同请求重试返回已有比赛，不因请求超时再创建一场；相同标识配不同参数应拒绝。

除幂等键外，数据库建立 `(initiator_id, game_id)` 的部分唯一索引，条件为 `status IN ('pending', 'running')`，阻止不同幂等键并发绕过“一场未完成主动请求”的限制。先查询幂等命中；新请求违反该约束时返回 409 和已有比赛 ID，不创建第二场。不能只靠事务内先查询再插入。[PostgreSQL 部分唯一索引](https://www.postgresql.org/docs/18/indexes-partial.html)

worker 用短事务锁定本机支持且有资源容量的任务，设置 `running`、租约到期时间和唯一执行标识，随后释放数据库锁再执行。领取使用 `SKIP LOCKED`，不得有两个 worker 同时拥有有效执行权。单个 worker 串行执行轮询，包含维护和领取；数据库响应变慢时不叠加轮询，正在领取的空位不能被另一轮重复使用。停止时先等待正在进行的领取结束，再等待已有执行退出并关闭连接；停止期间领取成功的比赛不再启动，由租约过期扫描收尾。

租约为 30 秒，每 5 秒续租。续租在短事务中锁定比赛行，取得锁后用数据库实时时钟检查原租约仍有效，再延长到期时间；不能使用事务开始时刻判断锁等待后的有效性，也不能重新激活过期租约。续租失败时停止分派新 tick，禁止提交结果。worker 只领取本机注册表内 `gameId` 与 `release` 都精确匹配的冻结发行，未安装的发行保持等待，不用当前规则替代执行。

租约过期处理需要比较执行标识，旧 worker 不能在失去租约后覆盖终态。已开始且失去主运行器状态的比赛标为 `failed`，不重新读最新源码冒充恢复。

该扫描只处理已经存在的比赛，不扫描用户生成新比赛。

比赛级 `failureReason` 为受控枚举：`ENTRY_CHANGED_BEFORE_START`（开局复查时代码与冻结发行不兼容）、`WORKER_LOST`（执行租约过期、主 worker 失联）、`EXECUTION_FAILED`（可信侧系统失败，如规则崩溃、平台输入超预算或回放无法保存）。玩家代码的 tick 级错误不属于比赛失败，正常计分。

## 幂等结算

1. worker 生成并可靠保存最终回放与结果，以比赛 ID 形成稳定引用。
2. 开启数据库事务，锁定比赛行，确认仍为 running、执行标识一致、租约有效且尚未结算；否则拒绝提交。
3. 按稳定顺序锁定参与者的 `game_entries` 排位行。
4. 按比赛类型结算：`ranked` / `arena` 更新 Elo 与统计，`solo` 更新最高分与场次，`practice` / `boss` 只记录本场结果；所有类型均保存参与者名次与得分。详细计分见 [排位设计](../designs/ranked.md)。
5. 同一事务中将比赛标记 `completed`，写入回放引用与最终结果。
6. 提交后释放任务和临时代码。

若已经完成，结算函数拒绝重复提交，公开查询仍返回已保存的结果，不能再次更新分数。若事务失败且仍持有有效租约，整次排位更新回滚后可重试。文件保存失败时不能提前结算。最终文件先保存为包含比赛 ID 和执行标识的不可覆盖候选路径，仅以数据库 completed 行引用的文件作为公开回放；失去执行权的旧 worker 不能覆盖另一个候选或公开文件。失败或无引用候选由清理任务删除，清理任务不创建新比赛。

server 与 worker 共用 `REPLAYS_DIR`（默认 `data/replays`），相对路径均以仓库根目录为基准，也可配置绝对路径。回放文件存储在此目录下：终稿名为 `<matchId>.json.gz`，候选写入 `candidates/<matchId>-<executionId>.json.gz`。结算事务在确认执行权后将候选硬链接为终稿，绝不覆盖。目标已存在时，仅允许它与本次不可变候选是同一个文件（设备号和 inode 均相同，且不是符号链接），使发布后数据库回滚的同一次执行可以安全重试；其他文件即使内容相同也拒绝。支持目录同步的平台在发布后同步终稿目录，再提交数据库。数据库行的 `replay_file` 记录终稿文件名、格式版本、压缩后字节数与 SHA-256。清理任务由 worker 周期执行：删除超过 1 小时的候选与超过 24 小时且未被任何 completed 比赛引用的终稿。

禁止在客户端计算排位，禁止客户端提交可信胜负。游戏包只提供比赛结果，平台评分实现决定排位变化。官方 bot 也使用这条路径。

## 注册、登录与会话

用户通过用户名和密码注册登录，不接入 GitHub、邮箱验证码或其他外部身份服务。用户名为 2–24 个 Unicode 码点（仅校验长度，不允许空字节），按小写规范化后作为唯一身份与展示名；`official` 与 `boss` 为保留用户名，官方账号和 Boss 账号由部署初始化创建，不接受普通登录。密码为 6–24 个 Unicode 码点（仅校验长度，不允许空字节），按原输入处理，不 trim 或静默截断。

采用 Node.js 异步 `crypto.scrypt`，参数为 `N=131072`、`r=8`、`p=1`、`maxmem=256MiB`，每个密码使用独立 16 字节随机盐，派生 64 字节摘要；参数与摘要以 `scrypt$N=…$r=…$p=…$<salt>$<digest>` 自描述字符串一起保存。比较解出摘要后使用定长的 timing-safe 比较，数据库不保存明文密码。参数采用 [OWASP 的 scrypt 配置](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)，接口使用 [Node.js crypto](https://nodejs.org/docs/latest-v26.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback)。API 每进程最多并行 2 个密码哈希任务，超出的认证请求返回 429，不进入无界等待队列。

登录成功创建 32 字节密码学随机会话 token，注册同时创建会话。token 以 `Authorization: Bearer <token>` 请求头传递并由客户端自行保存，数据库仅存 token 的 SHA-256 摘要。会话绝对有效期为 7 天，不自动滑动续期。登出删除当前会话行，立即失效；修改密码要求旧密码并撤销该用户全部旧会话。认证响应和自己的源码响应设置 `Cache-Control: no-store`，不启用 CORS，不开放跨源凭证访问。

密码验证在事务外异步执行，创建会话前在短事务内锁定用户行并确认密码摘要仍与验证时一致，避免并发改密后旧凭证重新生成会话。不存在的用户与无密码的官方账号也执行一次同参数的固定伪摘要校验，避免通过明显的哈希耗时差异探测账号。登录失败统一返回凭证错误，不区分用户不存在与密码错误。注册和登录请求 JSON 上限 4KiB。按 IP 对登录限流为每 5 分钟 10 次（每次尝试都计数）、注册为每小时 10 个成功账号（格式错误、用户名被占用不计数），返回 429 时附带 Retry-After。客户端 IP 取自 `TRUST_PROXY` 所列可信反代（proxy-addr 语法）转发的 `X-Forwarded-For`，生产 compose 默认 `uniquelocal`（Docker 内网的 caddy）；未配置时 server 只看到 caddy 的地址，全站会共享同一个限流计数。计数保存在 PostgreSQL，API 多进程共享；相应 `auth_rate_limits` 记录使用作用域（`login`、`register`）、主体摘要（IP 的 SHA-256）、时间窗口与计数作为键值，定期清理过期窗口。

首版提供注册、登录、登出和知道旧密码时的密码修改，不提供邮箱找回密码功能。

### 认证 API 契约

请求体为 JSON 对象，字段类型均为 string；成功响应如下：

| 接口                  | 请求字段                     | 成功响应                      |
| --------------------- | ---------------------------- | ----------------------------- |
| `POST /auth/register` | `username`、`password`       | 201，`{ user, token }`        |
| `POST /auth/login`    | `username`、`password`       | 200，`{ user, token }`        |
| `GET /auth/me`        | 无                           | 200，`{ user }`               |
| `POST /auth/logout`   | 无                           | 204，无响应体                 |
| `PUT /auth/password`  | `oldPassword`、`newPassword` | 204，无响应体；所有旧会话失效 |

`user` 包含 `id`、规范化后的 `username` 与 `official`。返回的 token 由客户端保存并通过 Bearer 请求头使用。

错误响应为包含 `code` 和 `message` 的 JSON 对象：

| 状态码 | code                  | 含义                                     |
| ------ | --------------------- | ---------------------------------------- |
| 400    | `VALIDATION_ERROR`    | 凭证长度或请求格式不合法                 |
| 401    | `INVALID_CREDENTIALS` | 登录失败或旧密码错误                     |
| 401    | `UNAUTHORIZED`        | 无有效会话                               |
| 409    | `USERNAME_TAKEN`      | 规范化用户名冲突                         |
| 413    | `BODY_TOO_LARGE`      | 请求体超过 4KiB                          |
| 429    | `RATE_LIMITED`        | 认证限流或密码哈希饱和，附 `Retry-After` |

### 系统账号初始化

官方账号在 server 启动时幂等初始化：upsert `official` 用户（无密码、带官方标记），并为每个已注册游戏读取其官方 bot 源码，写入或更新 `game_entries` 的源码、字节数与协议版本；排位分与比赛统计不受初始化影响。官方 bot 源码超过当前发行 `codeBytes` 限制时启动失败并报告明确错误。

Boss 账号同样在启动时初始化：upsert `boss` 用户（无密码、带 Boss 标记），读取 `BOSSES_DIR`（默认 `data/bosses`）下的 `<gameId>.js` 作为该游戏的 Boss 代码；文件不存在的游戏删除 Boss 的参赛记录，挑战入口随之关闭。Boss 源码不通过任何接口、开发包或 npm 包公开。

## 游戏参赛 API

### 当前参赛状态

`GET /games/:gameId/me` 要求认证，返回：

| 字段                | 内容                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `entry`             | `rank`、`rating`、`matchesPlayed`、`wins`、`draws`、`losses`、`placementTotal`、`bestScore` |
| `boss`              | `available`、已完成挑战次数 `attempts`、获胜次数 `wins`                                     |
| `code`              | `{ source, sourceBytes, botProtocolVersion, updatedAt }`；未上传时为 `null`                 |
| `canMatch`          | 当前代码是否满足参赛条件；不表示 worker 空闲或竞技场空闲                                    |
| `cannotMatchReason` | `NO_CODE`、`PROTOCOL_MISMATCH`、`CODE_TOO_LARGE` 或 `null`                                  |
| `activeMatch`       | 本人在该游戏发起且未完成的 `{ id, status }`，无则为 `null`                                  |

`rank` 是对应游戏的榜单名次，无参赛记录或系统账号时为 `null`。`placementTotal` 用于竞技场平均名次，`bestScore` 用于单人最高分；其他模式返回这些字段的存储值，不据此改变榜单类型。被动参赛不占用 `activeMatch`，也不阻止主动参赛。

### 上传代码

`PUT /games/:gameId/me/code` 要求认证，请求为 `text/plain` UTF-8 源码，最大字节数为当前发行的 `resolvedLimits.codeBytes`。成功返回 200 和 `{ sourceBytes, botProtocolVersion, updatedAt }`。仅替换最新源码及其元数据，不创建比赛、不重置成绩。

| 状态码 | code               | 含义                                 |
| ------ | ------------------ | ------------------------------------ |
| 400    | `VALIDATION_ERROR` | 非法 UTF-8 或空源码                  |
| 400    | `CODE_INVALID`     | AST 约束或同版 V8 模块编译校验未通过 |
| 413    | `BODY_TOO_LARGE`   | 源码超过体积限制                     |
| 429    | `RATE_LIMITED`     | 校验并发已满，附 `Retry-After`       |

每进程最多同时校验 2 份源码；校验失败保留原代码。静态校验不执行玩家入口，不保证运行时动作合法或不超限。

## 创建比赛 API

### 双人比赛与单人挑战

`POST /games/:gameId/matches` 要求认证和 1–100 字符的 `Idempotency-Key` 请求头。请求体省略或使用 JSON，合法形状如下：

| 请求体                          | 双人游戏                                               | 单人游戏                     |
| ------------------------------- | ------------------------------------------------------ | ---------------------------- |
| 省略或 `{}`                     | 匹配普通选手；无候选时与官方 bot 练习                  | 创建只有发起者的 `solo` 比赛 |
| `{ "opponentId": "对手 UUID" }` | 指定非本人、非 Boss、代码可运行的对手，创建 `practice` | 400 `VALIDATION_ERROR`       |
| `{ "boss": true }`              | 挑战当前游戏 Boss，创建 `boss`                         | 400 `VALIDATION_ERROR`       |

其他形状返回 400 `VALIDATION_ERROR`。声明 `arena` 的游戏使用竞技场接口，新请求走此接口返回 409 `ARENA_GAME`。

创建成功返回 201 和比赛详情；同一请求重试返回 200 和已有比赛。同键不同游戏返回 409 `IDEMPOTENCY_MISMATCH`。事务固定参与者、比赛类型、游戏发行、配置、完整限额、玩家协议与随机 uint32 种子。发起者固定为 slot 0；源码由 worker 开始执行时读取。

| 状态码 | code                                               | 含义                                   |
| ------ | -------------------------------------------------- | -------------------------------------- |
| 409    | `MATCH_ALREADY_PENDING`                            | 已有未完成主动请求，响应包含 `matchId` |
| 409    | `NO_CODE` / `PROTOCOL_MISMATCH` / `CODE_TOO_LARGE` | 当前代码无法参赛                       |
| 409    | `OPPONENT_IS_SELF` / `OPPONENT_UNAVAILABLE`        | 指定对手为本人，或不存在、代码不可运行 |
| 404    | `BOSS_UNAVAILABLE`                                 | 未安装该游戏 Boss                      |

对手筛选和计分以 [排位设计](../designs/ranked.md) 为准，本接口不接受客户端覆盖正式比赛配置和资源预算。

### 多人竞技场

声明 manifest `arena` 的游戏提供两个接口：

| 接口                        | 认证                         | 行为                                                 |
| --------------------------- | ---------------------------- | ---------------------------------------------------- |
| `GET /games/:gameId/arena`  | 不要求                       | 返回 `{ active, lineup, recent }`                    |
| `POST /games/:gameId/arena` | 要求，携带 `Idempotency-Key` | 固定阵容并创建 `arena` 比赛，成功返回 201 和比赛详情 |

`active` 为唯一未完成竞技场比赛或 `null`。`lineup` 是此刻发起一场比赛的预览：已登录且有合格代码时本人占第一席，其余席位取其他合格普通选手；其他访问者看到榜首阵容。不足时官方账号补一个席位。每项包含 `userId`、`username`、`official`、`rating`、`wins`、`matchesPlayed`、`codeUpdatedAt`。预览不锁定阵容，以创建事务中的选择为准。

`recent` 为保留中的已结束比赛详情，最多 `keepMatches` 场，按创建时间倒序。完成或失败都可能出现在列表里。

创建时开局者必定入场。代码不合格返回对应 409；已有未完成竞技场返回 409 `ARENA_BUSY` 并携带 `matchId`；人数不足返回 409 `ARENA_TOO_FEW_PLAYERS`。数据库部分唯一索引保证每个游戏只有一场未完成竞技场比赛。结算后删除保留数以外的终态比赛及回放，累计成绩不回退。

### 当前实现边界

以下差距不能当作已满足的接口保证：

- 幂等契约要求键绑定完整请求内容。当前双人/单人接口查重比较用户、键与游戏，尚未比较同游戏请求中的 `opponentId` / `boss`；调用方不得把同一键用于不同意图。
- 竞技场重试在重复键处理前会检查当前代码与活动比赛，可能先返回代码错误或 `ARENA_BUSY`；尚不能保证所有重试路径都返回原比赛。
- `code.updatedAt` 和竞技场 `codeUpdatedAt` 当前复用 `game_entries.updated_at`，结算也会更新它，不能据此识别策略是否刚被上传。这与字段的代码更新时间语义有差距。

对应实现见 [创建接口](../../apps/server/src/matches/routes.ts)、[竞技场接口](../../apps/server/src/arena/routes.ts) 和 [结算](../../apps/worker/src/settle.ts)。这些边界不改变上文的规范要求。

## 查询 API

### 排行榜

`GET /games/:gameId/leaderboard` 公开，返回 `{ total, page, limit, players }`。每个 player 包含 `rank`、`userId`、`username`、`official`、`rating`、`matchesPlayed`、`wins`、`draws`、`losses`、`placementTotal`、`bestScore`，不含官方账号与 Boss。

| 模式   | 排名依据     | 同分展示顺序                                          |
| ------ | ------------ | ----------------------------------------------------- |
| 双人   | 内部精确 Elo | 用户 ID                                               |
| 竞技场 | 内部精确 Elo | `tieBreakGameId` 的 Elo（无记录按 1000），再按用户 ID |
| 单人   | `bestScore`  | 用户 ID                                               |

排名依据相同则并列；展示顺序不改变并列名次。当前上传记录即进入榜单，不要求先完成比赛。

排行榜与比赛历史共用分页：`page` 默认 1，范围 1–1,000,000；`limit` 默认 50，范围 1–100。缺省、空或非法数值取默认值，超范围数值被钳制。

### 比赛历史、详情与回放

`GET /games/:gameId/me/matches` 要求认证，按创建时间倒序返回 `{ total, page, limit, matches }`，包含本人主动和被动参与的比赛，列表项为比赛详情。

`GET /matches/:matchId` 公开，返回：

| 字段                             | 内容                                                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `id`、`gameId`、`kind`、`status` | 身份、模式与生命周期                                                                                             |
| `createdAt`、`updatedAt`         | ISO 时间                                                                                                         |
| `release`、`seed`、`initiatorId` | 创建时固定的信息                                                                                                 |
| `participants`                   | 用户 ID、用户名与官方/Boss 身份快照、slot；结算后附 `rank`、`score`，Elo 模式另附 `ratingBefore` / `ratingAfter` |
| `result`                         | completed 时附游戏结果                                                                                           |
| `failureReason`                  | failed 时附受控原因，不公开内部堆栈                                                                              |

未知或非法比赛 ID 返回 404 `MATCH_NOT_FOUND`。`GET /matches/:matchId/replay` 仅在 completed 时提供 `application/gzip` 文件；未结束返回 409 `REPLAY_NOT_READY`，回放引用或存储根目录不可用返回 503 `REPLAY_UNAVAILABLE`；已引用的文件不存在返回 404 `REPLAY_NOT_FOUND`。不设置 `Content-Encoding`，浏览器与 CLI 自行解压并校验。

网页对进行中比赛每秒查询一次；失败按 2/4/8 秒退避，页面隐藏时暂停，恢复可见立即查询，终态停止。不提供线上实时 tick 推流。

## 路由索引

| 方法与路径                        | 行为                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `POST /auth/register`             | 用户名和密码注册，并创建会话                                                                                 |
| `POST /auth/login`                | 登录并创建会话，返回当前用户与 token                                                                         |
| `GET /auth/me`                    | 当前用户；无有效会话时返回 401                                                                               |
| `POST /auth/logout`               | 撤销当前会话                                                                                                 |
| `PUT /auth/password`              | 验证旧密码后修改，撤销全部会话并要求重新登录                                                                 |
| `GET /games`                      | 游戏目录和基本信息                                                                                           |
| `GET /games/:gameId`              | 当前发行、基本玩法、配置与完整资源限额                                                                       |
| `GET /games/:gameId/development`  | 当前发行的 `{ prompt, sdk, officialBot, template }` 纯文本资料                                               |
| `GET /games/:gameId/devkit`       | 当前游戏最新开发包元数据，含摘要、大小和下载地址，no-store                                                   |
| `GET /games/:gameId/download`     | 直接返回当前 ZIP，no-store；ETag 为 ZIP SHA-256，If-Match 不匹配返回 412                                     |
| `GET /games/:gameId/official-bot` | 当前官方 bot 源码                                                                                            |
| `GET /games/:gameId/me`           | 当前用户的参赛信息、最新代码、botProtocolVersion 与 canMatch/不能参赛原因                                    |
| `PUT /games/:gameId/me/code`      | 覆盖最新代码，不运行比赛                                                                                     |
| `POST /games/:gameId/matches`     | 双人匹配/练习/Boss 或单人挑战，使用 Idempotency-Key                                                          |
| `GET /games/:gameId/arena`        | 当前竞技场、阵容预览和保留的比赛                                                                             |
| `POST /games/:gameId/arena`       | 主动创建多人竞技场，使用 Idempotency-Key                                                                     |
| `GET /games/:gameId/leaderboard`  | 分页排行榜                                                                                                   |
| `GET /games/:gameId/me/matches`   | 当前用户作为发起者或对手的比赛记录                                                                           |
| `GET /matches/:matchId`           | 状态、参与者、结果、排位变化或系统失败原因                                                                   |
| `GET /matches/:matchId/replay`    | completed 时返回 application/gzip 回放，其他状态返回 409；不设置 Content-Encoding，以便浏览器与 CLI 统一解压 |

## 访问边界

- 上传、主动匹配、读取自己的代码要求认证，主体从会话获得，不能信任 body 中的 user ID。
- 游戏规则、官方示例、下载包、排行榜可公开。
- 首版已完成比赛的结果和回放可公开，用于观赏；包含参赛者公开身份与动作，不含普通用户源码、Memory 或玩家 console 日志。
- 失败任务的内部堆栈和基础设施信息不直接公开，用户看到受控错误摘要。
- 本地调试服务默认仅监听 loopback，不成为平台远程调试 API。

## 必要索引

- `game_entries(game_id, user_id)` 唯一。
- `game_entries(game_id, rating DESC, user_id)` 用于对抗游戏匹配和排行榜，rating 为 `numeric(12,6)`，默认 1000。
- `game_entries(game_id, best_score DESC, user_id)` 用于单人榜单，best_score 为整数，默认 0。
- `users(normalized_username)` 唯一；`sessions(token_hash)` 唯一，`sessions(user_id)` 和 `sessions(expires_at)` 用于撤销与清理。
- `matches(initiator_id, idempotency_key)` 唯一，幂等标识不允许为空绕过。
- `matches(initiator_id, game_id)` 在 `status IN ('pending', 'running')` 时唯一，约束未完成主动请求。
- `matches(game_id)` 在 `kind = 'arena' AND status IN ('pending', 'running')` 时唯一，保证每个竞技场同一时间只跑一场；`matches(game_id, kind, created_at)` 用于竞技场历史与近期对手查询。
- `matches(status, created_at)` 用于任务领取；运行租约索引用于过期处理。
- `match_participants(user_id, match_id)` 用于用户比赛记录。

参与者人数满足冻结游戏配置，用户 ID 不重复。双人比赛固定两席，竞技场遵守游戏人数范围，单人挑战固定一席；所有模式的发起者都必须在参与者中。双人匹配、挑战与官方回退的对手均排除本人。参与者在创建比赛时固定，最终结果的用户集合必须与之完全一致。

所有主键使用 UUID，时间使用 `timestamptz`，JSON 结果与配置使用 `jsonb`。比赛状态使用受约束文本枚举，状态、执行标识与结算字段在同一事务更新。`auth_rate_limits(scope, subject_hash, window_start)` 唯一；这些约束由 Drizzle 迁移创建，不依赖应用查询约定替代数据库约束。
