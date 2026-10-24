# 系统架构与技术选型

## 技术栈

| 层次     | 选型与职责                                                        |
| -------- | ----------------------------------------------------------------- |
| 前端     | Vue 3 + TypeScript + Vite + Vue Router + Tailwind CSS             |
| 包管理   | pnpm 12 workspace，以 pnpm 脚本编排构建，不额外引入 monorepo 框架 |
| 业务 API | Node.js 26 + TypeScript + Fastify 5                               |
| 数据     | PostgreSQL 18 + Drizzle ORM + node-postgres                       |
| 任务     | 首版 PostgreSQL 任务表，短事务领取、租约、幂等终态                |
| 比赛运行 | 独立 Node.js worker，调用共享引擎和游戏包                         |
| 玩家执行 | isolated-vm（V8 isolate），独立比赛进程                           |
| 可视化   | 通用 Vue 播放器 + 游戏 renderer；首款网格游戏使用 Canvas          |

选择 Fastify 是为了直接实现业务 API，并与前端、引擎、本地工具共享 TS 协议和包。它的插件和 schema 机制用于组织可信服务代码，不把 Fastify 插件等同于游戏插件。[Fastify 文档](https://fastify.dev/docs/latest/Reference/)

PostgreSQL 的事务同时覆盖比赛终态与双方排位更新。Drizzle 提供 TS 查询及迁移能力，直接使用 PostgreSQL 驱动。[Drizzle 文档](https://orm.drizzle.team/docs/get-started-postgresql)

系统使用 PostgreSQL 任务表，不引入 Redis、Kafka、微服务网关或模型 API。增加 worker 数量只改变任务处理能力，不能改变“用户主动发起才开赛”的语义。

## 系统关系

```mermaid
flowchart TD
    Web[Vue 网站] -->|上传 / 主动匹配 / 查询| API[Fastify 业务服务]
    API --> DB[(PostgreSQL)]
    Worker[比赛 worker] -->|领取已有任务 / 结算| DB
    Worker --> Runner[每场比赛执行进程]
    Runner --> Engine[共享 tick 引擎 + 游戏规则]
    Runner --> QA[玩家 A isolate]
    Runner --> QB[玩家 B isolate]
    Runner --> Candidate[可靠回放候选]
    Candidate --> Worker
    Worker --> Replays[公开回放存储]
    Web -->|读取回放| Replays
    Web --> Player[共享播放器 + 游戏渲染器]
```

## 职责划分

### 业务服务

负责身份认证、官方账号标记、游戏列表、最新代码上传、主动匹配、榜单和比赛查询。上传只做体积、编码、语法及入口格式检查，不通过执行用户代码完成校验，不创建试跑比赛。

匹配请求选择对手并创建任务。系统中不存在周期性扫描选手并创建新比赛的路径。网页查询比赛状态使用 GET，不隐式触发 POST 匹配。

### 比赛 worker

领取已存在任务，读取本场代码到内存，通过 runner 启动比赛进程。比赛进程加载可信游戏规则、驱动 tick 并保存回放候选；worker 确认有效租约后发布公开回放并结算。

比赛进程在 isolate 外持有权威世界和最近成功的 Memory，不持有业务凭证。玩家普通执行异常仅重建对应 isolate；比赛进程崩溃则该场系统失败、不计分，其他比赛继续。

### 游戏规则与玩家代码

游戏规则是经过平台审核、随仓库构建的可信模块，在引擎侧运行。玩家代码接收由序列化公开观察构造的游戏视图与自己的 Memory，通过游戏自定义的基础动作方法登记意图，包装器统一提交规范命令后影响世界，不直接调用数据库、文件或渲染器。

规则引擎自身崩溃属于系统失败；玩家 JS 抛异常属于比赛内错误，二者不能混为一类。

## 任务生命周期

`pending → running → completed`，系统失败进入 `failed`。

- API 显式创建 `pending`，worker 通过短事务领取，写入租约与执行标识。
- worker 执行期间续租；数据库锁不跨越整场比赛持有。
- `pending` 尚未开始的任务可以重新领取。
- `running` 的主 worker 失联且无法证明执行结果完整时，本场标记失败、不计分。
- 玩家执行异常丢弃当前动作与候选 Memory，下一 tick 从旧 Memory 重建 isolate；比赛进程丢失则整场失败，不进行进程级续跑。
- 完整回放和最终结果已可靠形成且执行租约有效时，允许重试保存与幂等结算；失去租约不得提交。
- 已排队比赛开局前发现最新代码不再兼容其冻结发行时，以 ENTRY_CHANGED_BEFORE_START 失败、不计分，不强行运行或自动换规则。

不保存历史源码意味着无法保证重跑崩溃比赛仍使用旧代码，因此不声称支持执行中的比赛透明恢复。用户可重新主动匹配，产生一个新的比赛 ID。

任务领取可使用 PostgreSQL `FOR UPDATE SKIP LOCKED`，其用途限于任务竞争，不用于普通一致性读取。[PostgreSQL 文档](https://www.postgresql.org/docs/current/sql-select.html)

## 部署与存储

采用 Linux 单机部署，API、主 worker 和比赛执行子进程具有独立生命周期。PostgreSQL 为独立依赖，回放保存到受控数据目录，数据库保存文件引用及摘要。每个 worker 同时执行 2 场圈地比赛。具体部署形态、镜像编排与上线步骤见 [部署与发布](deployment.md)。

比赛创建时固定规则发行、实际配置和完整 resolvedLimits；worker 只领取本机已安装且资源容量可满足的发行。每位玩家的最新代码在开局时按该冻结协议再次检查。发行标识不等于代码兼容版本，兼容规则见 [游戏模块](monorepo-and-modules.md)。

线上独立进程内存硬限制要求使用 Linux cgroup v2；当前生产 Compose 默认 `local`，尚未启用，具体差距见 [资源限额](resource-limits.md#进程硬限制的启用条件)。比赛进程内的 isolate 负责玩家级限额，进程级崩溃为整场系统失败。启用 cgroup 时，比赛执行子进程具有独立资源组，不继承 API/数据库密钥。网络命名空间、只读运行文件系统、低权限用户与 seccomp 属于部署侧配置，runner 本身只负责 cgroup 限制。资源组的 `memory.max` 使用该游戏发行的 `resolvedLimits.runnerMemoryBytes`（平台默认 536870912，即 512MiB），同时设置 `memory.swap.max=0` 和 `pids.max=64`。选择 cgroup-v2 后，隔离设施无法建立时拒绝执行该场比赛，不回退到 local。

本地 CLI 复用相同执行代码，但不要求用户安装 PostgreSQL 或运行平台服务。可移植性与操作系统级隔离能力是两回事，不能把本地默认运行方式直接当作线上配置。

## 相关文档

- [Monorepo 与游戏模块](monorepo-and-modules.md)
- [沙箱](sandbox.md)
- [数据模型与 API](data-model-and-api.md)
