# 部署与发布

本文定义生产部署形态、上线步骤与 npm 发布流程。本地开发环境见 [开发指南](../development.md)；本文只关心把已验证的构建产物放到公网。

## 部署形态

单机 Linux 部署，全部组件由 `deploy/compose.prod.yaml` 编排：

| 组件   | 形态                                                                  |
| ------ | --------------------------------------------------------------------- |
| `db`   | postgres:18 容器，数据在命名卷，不暴露宿主端口                        |
| server | `app` 镜像，一次性 `migrate` 服务完成后启动                           |
| worker | 同 `app` 镜像，与 server 共享 `replays_data` 卷（回放终稿硬链接发布） |
| web    | `web` 镜像：Caddy 托管 SPA 静态文件，反代 `/api` 与 `/health`         |
| Caddy  | 按 `CADDY_DOMAIN` 自动申请并续期 TLS；未设置域名时只监听 80           |

镜像由 `deploy/Dockerfile` 的两个 target 构建（构建上下文仍是仓库根）：

- `app`：`node:26-slim` + pnpm 12.14.0，包含完整 workspace 构建产物与依赖。保留仓库目录布局，使启动脚本、drizzle 迁移与 `games/*` 的官方 bot 等按相对路径解析的资源全部成立；isolated-vm 的 Linux 预编译二进制随 `--ignore-scripts` 安装，由 `node-gyp-build` 在加载时选取。server 与 worker 共用该镜像，仅启动命令不同。
- `web`：`caddy:2-alpine` + `apps/web/dist` 静态文件 + `deploy/Caddyfile`。

凭据统一放 `.env.prod`（参照 `.env.prod.example`，已被 git 忽略）。`POSTGRES_PASSWORD` 必填，用 `openssl rand -hex 24` 生成——密码会原样拼进 `DATABASE_URL`，使用十六进制字符可避免额外的 URL 编码处理；`CADDY_DOMAIN` 决定是否启用自动 HTTPS。`HTTP_PORT`/`HTTPS_PORT`（默认 80/443）可把 caddy 发布到非标准宿主端口，用于与既有服务共机：此时 Let's Encrypt 的挑战流量到不了容器，`CADDY_DOMAIN` 必须留空走纯 HTTP，且两个端口都要换——任一映射仍占宿主 80/443 都会绑定冲突。所有 compose 命令都显式携带 `--env-file .env.prod`，避免误读开发用 `.env`。

## 前置条件

1. 一台 Linux 服务器（amd64/arm64 皆可）与已安装的 Docker Engine、Compose 插件。采用下文的宿主构建开发包流程时，还需 Node.js 26、pnpm 12 与已安装的仓库依赖；也可从同一源码构建后复制 data/releases 到部署机。
2. 启用 HTTPS 时，域名 DNS A/AAAA 指向服务器并让证书验证流量到达 Caddy。无域名的本地试用可以使用 IP 与 HTTP。
3. npm 上拥有 `@si-arena` 组织且本机 `pnpm whoami` 具有发布权限（仅发布 CLI 时需要）。
4. 确认数据库、回放与发行卷的备份位置，以及采用的进程隔离模式；默认 Compose 的边界见文末。

## 首次上线

在服务器上的仓库目录内执行：

```sh
if [ ! -e .env.prod ]; then cp .env.prod.example .env.prod; fi
# 编辑 .env.prod：填写 POSTGRES_PASSWORD 与 CADDY_DOMAIN，然后再启动

# 1. 构建镜像并启动数据库与迁移（server/worker 会等迁移完成后自启）
docker compose --env-file .env.prod -f deploy/compose.prod.yaml up -d --build

# 2. 生成开发包发行并注入共享卷（本机生成后随仓库目录部署到服务器）
pnpm build:devkits
docker compose --env-file .env.prod -f deploy/compose.prod.yaml --profile tools run --rm seed-releases
```

`seed-releases` 把宿主 `./data/releases` 中各游戏的当前开发包同步到 releases_data 卷。每个游戏目录保存 current.json 完整元数据和摘要命名 ZIP；先复制完整 ZIP，再原子替换当前元数据。资料变化重新构建并 seed 即可；规则或执行契约变化仍需升级游戏发行。玩家只下载当前包，旧回放的可信规则归档单独管理。存储布局升级后需要重新构建并 seed，旧发行/修订 URL 不再提供下载。

## 更新部署

部署前备份数据库与回放，确认将要应用的迁移。检出要部署的源码后重新构建镜像并启动：

```sh
docker compose --env-file .env.prod -f deploy/compose.prod.yaml up -d --build
```

镜像更新不会自动把宿主开发包同步进发行卷。游戏、工具或资料变化时，必须基于同一源码再次运行 `pnpm build:devkits` 与 `seed-releases`，然后检查网页资料和下载包一致。仅修改提示词无需升级游戏 release；改变规则或执行契约则按 [分发设计](distribution-and-development.md) 更新发行并处理历史回放注册。

## Boss

Boss 是部署方私有的 bot，源码不进仓库。双人游戏支持 Boss 挑战。把其 Boss 代码放到宿主 `./data/bosses/<gameId>.js`（例如 `data/bosses/paper.js`），compose 以只读方式挂载给 server；server 每次启动时安装或更新 Boss，目录里没有对应文件的游戏自动关闭 Boss 挑战。更换 Boss 代码后重启 server 即可。Boss 代码同样受该游戏发行的 `codeBytes` 限制，超限时 server 启动失败。

## 冒烟清单

用专门的验收账号运行以下流程；普通用户之间的排位与单人挑战会真实更新这些账号的成绩。

| 检查                          | 预期结果                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------- |
| GET `/health` 与 `/api/games` | HTTP 服务正常，目录列出部署的游戏；health 不代表数据库或 worker 就绪            |
| 注册、登录、上传代码          | 上传成功，未自动创建比赛                                                        |
| 双人游戏指定官方 bot 练习     | 比赛完成并可回放，双方排位不变                                                  |
| 两名普通验收用户主动匹配      | 创建 ranked 比赛，完成后双方统计更新，Elo 按胜平负结算；平局可能不变分          |
| 开启多人竞技场                | 开局者入场，同时重复开局被拒绝，完成后按名次结算                                |
| 开启 tetris 单人挑战          | 仅本人入场，完成后次数加一，bestScore 取原纪录与本局得分的较大值                |
| 下载回放                      | completed 的 `/api/matches/:id/replay` 返回 gzip，网页重演校验成功              |
| 下载开发包                    | 另一台机器用实际平台地址 init、安装依赖后，`pnpm arena run --bot ./bot.js` 成功 |
| 查看开发资料                  | 提示词、SDK、官方 bot 和 ZIP 可获取，发行一致                                   |

若没有部署相应模式，按实际游戏目录选择验收项；不要用未执行的项目宣称通过。

## 版本与 npm 发布

公开工具包采用统一版本（lockstep）：protocol、sandbox、engine、runner、player、cli 在 pnpm-workspace.yaml 的 versioning.fixed 中组成固定组。游戏包和 development 是私有 workspace 模块，与平台应用及 db 一起排除在公开发布和升版之外。新增或更新游戏只需要部署平台及当前开发包，不需要发布 npm。发版流程：

```sh
# 1. 记录变更意图（哪些包受影响、bump 级别、changelog 摘要）
pnpm change <包名...> --bump <patch|minor|major> --summary "…"

# 2. 应用发布计划：固定组统一升版，private 包不动；递归模式不产生 git 提交
pnpm version -r
git add -A && git commit -m "chore: release <版本>"

# 3. 发布（CLI 默认连 loopback，平台地址由玩家通过 --server 传入，发布与部署解耦）
pnpm publish:packages [--otp <验证码>]
```

`scripts/publish.ts` 只做执行器：校验工作区干净、公开包版本一致、抽查 CLI tarball 中 `workspace:*` 已替换为当前版本，然后按依赖拓扑序（protocol → sandbox → engine → runner → player → cli）以 `--access public` 发布。`--dry-run` 走全链但不真正发布，用于演练。npm 账号开启 2FA 时用 `--otp` 或 `NPM_CONFIG_OTP` 传入验证码。

发布后注意：

- 开发包发行与 npm 版本是两条线：devkit 内部包走 vendor 本地归档，不要求已发布 npm；游戏与工具内容由清单中的摘要及组件版本固定，游戏内容更新无需 npm 发布。
- CI（`.github/workflows/ci.yml`）在 push/PR 时运行 `pnpm check`、`pnpm test:artifacts` 与两个镜像的 docker build，不自动发布。

## 数据与备份

- `postgres_data` 卷：用 `docker compose --env-file .env.prod -f deploy/compose.prod.yaml exec db pg_dump -U si_arena si_arena` 定期导出。
- `replays_data` 卷：回放终稿为不可覆盖资产，随卷一起备份。
- `releases_data` 卷内容可随时从仓库 `data/releases` 重新 seed，无需单独备份。
- `caddy_data` 卷保存 TLS 证书，丢失后自动重新申请。

## 进程资源隔离

当前生产 Compose 固定 `WORKER_ISOLATION=local`。isolate 的 CPU、堆和墙钟限制及输出预算生效，`stackBytes` 不控制线程栈；每场子进程的 RSS 没有 cgroup 硬上限。这尚未满足 [资源规范](resource-limits.md#进程硬限制的启用条件) 中线上每场独立资源组的要求。

启用内核级限制需要部署方同时完成：

1. 在 Linux 宿主准备通过 systemd `Delegate=` 等机制委托的 cgroup v2 目录。
2. 将该目录以可操作子资源组的权限挂载进 worker 容器。
3. 通过 Compose 覆盖配置把 worker 的 `WORKER_ISOLATION` 改为 `cgroup-v2`，并将 `WORKER_CGROUP_ROOT` 指向容器内的绝对挂载路径。只在 `.env.prod` 中添加变量不会覆盖原文件里固定的 `local` 值。
4. 运行真实 cgroup 测试，确认比赛资源组按发行预算建立，且建立失败不会降级运行。

runner 设置 `memory.max`、`memory.swap.max=0`、`pids.max=64` 和 OOM 组杀。网络、文件系统、低权限身份和系统调用限制仍由部署环境负责；runner 的资源组不提供这些边界。测试入口见 [runner README](../../packages/runner/README.md)。
