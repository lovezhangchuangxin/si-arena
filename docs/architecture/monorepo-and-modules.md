# Monorepo 与游戏模块

## 目录

仓库项目标识为 `si-arena`，产品名称为 SI Arena，SI 代表 Super Intelligence。对外发布的 npm 包统一使用 `@si-arena` 组织：公共包按职责命名为 `@si-arena/protocol`、`@si-arena/engine`、`@si-arena/sandbox`、`@si-arena/runner`、`@si-arena/player` 和 `@si-arena/cli`，游戏包采用 `@si-arena/game-<gameId>`，圈地为 `@si-arena/game-paper`；游戏包和 `@si-arena/development` 均为私有 workspace 模块，不公开发布 npm，也不参与公开包统一升版。平台 web、server 和 worker 是私有 workspace 应用，不作为玩家开发包发布。`@si-arena/db` 是私有共享包，承载 Drizzle 表结构、数据库连接工厂与迁移目录，仅供 server 和 worker 在 workspace 内部使用，不对外发布。

```text
configs/
  typescript/
    base.json            共享 TypeScript 编译选项
    test.json            测试源码映射与检查范围
    tooling.json         工具配置与脚本类型检查
  vitest/
    shared.ts            测试项目共享设置
apps/
  web/                   Vue 平台网站
  server/                Fastify API 与主动匹配
  worker/                比赛任务、回放保存、排位结算
packages/
  protocol/              游戏契约、JSON 类型、回放协议
  development/           公共研究提示词、资料组装、当前开发包存储
  engine/                通用 tick 循环与执行编排
  sandbox/               isolate 运行时、资源计量、玩家提交
  runner/                独立比赛进程、可信注册、有界通信与监督
  player/                Vue 回放播放器与通用控件
  cli/                   本地运行命令与调试服务
  db/                    共享 Drizzle 表结构、数据库连接与迁移（私有包）
games/
  paper/
    src/
      manifest.ts        游戏信息、人数与限制配置
      rules/             纯规则逻辑
      sdk/               玩家视图、基础动作 API、提示词
      renderer/          Vue 面板、Canvas 绘制与动画
    bots/official.js     官方源码
    README.md            游戏使用说明
```

一个游戏目录可作为一个 workspace 包，通过不同 export 入口导出规则、SDK、renderer 和官方代码资源。游戏作为内部模块组织，编译产物通过服务器开发包分发，不需要 npm 发布。Node 运行器不能因导入规则入口而加载 Vue/DOM，网页也不能因导入 renderer 而打入子进程代码。

## 依赖方向

- `protocol` 不依赖其他业务包，不包含运行器和数据库。
- `development` 只依赖 protocol 和 Node 文件 API，供 server 与构建脚本组装资料和管理当前开发包；不进入规则、沙箱或浏览器运行时。
- `sandbox` 依赖协议，不依赖账号、排位、游戏画面或数据库。
- `engine` 依赖协议，通过执行适配器调用沙箱，不依赖某个具体游戏。
- 游戏规则和 SDK 依赖协议及必要纯函数，不依赖平台业务。
- `player` 依赖协议、引擎的浏览器兼容核心和 Vue，不执行 bot，不导入沙箱或引擎的 Node 文件入口。通用入口提供校验会话与调度，`player/browser` 提供文件读取与可信 renderer 注册。
- `runner` 依赖 engine、sandbox 与 protocol，在每场独立进程内组装规则、isolate 和回放写入，不依赖数据库。
- `worker` 通过 runner 执行可信注册游戏，并负责租约、公开回放和数据库结算。
- `cli` 对应 npm 包 `@si-arena/cli`，提供 `arena` 可执行入口，通过同样的 runner 执行游戏，使用本地文件代替数据库；`init` 按游戏下载对应开发包。
- `web` 组装通用播放器与已注册游戏 renderer。

依赖环、从游戏规则导入业务数据库、从本地工具调用平台私有 API 均应作为结构错误处理。

## 模块解析与构建

仓库源码采用 TypeScript ESM，相对 TypeScript 导入省略扩展名，目录入口也可省略 `index`。Vue、CSS 等资源保留实际扩展名；跨包使用公开的包名或 export 子路径，不引用其他包的源码路径。

共享 TypeScript 配置位于 `configs/typescript/base.json`，使用 `module: ESNext`、`moduleResolution: Bundler` 与 `noEmit`，`tsc` 负责类型检查。`configs/typescript/tooling.json` 检查根工具入口、configs 下的 TypeScript 配置和 scripts 下的脚本。各 workspace 保留自己的配置入口并继承共享配置；根目录保留 `vitest.config.ts` 与 `tsdown.config.ts` 工具入口。Node 应用、共享包和游戏包使用根 `tsdown.config.ts`，以 unbundle 模式保持 `src` 到 `dist` 的目录对应关系，并输出 ESM、类型声明与 source map。前端由 Vite 构建。

构建器负责将产物的相对导入解析为 Node 可加载的文件路径；运行时入口和 package exports 仍指向实际的 `.js`、`.d.ts` 文件。开发时 Node 应用通过 tsx 解析源码，不要求生产环境安装自定义模块加载器。游戏的纯规则、SDK 与 renderer 出口保持独立，构建不能将其合并成带入服务端或浏览器专属依赖的单一入口。

## 测试项目

整个 monorepo 使用 Vitest，不为各游戏引入不同测试框架。根 `vitest.config.ts` 只承担项目发现、统一报告与 V8 覆盖率；各 workspace 用 `vitest.config.ts` 声明唯一项目名、根目录与环境，并显式合并 `configs/vitest/shared.ts`。需要分离 renderer 与规则测试时，新增命名配置如 `vitest.renderer.config.ts`，根目录的通配发现无需逐个登记。

纯规则、协议、引擎、沙箱、CLI、server 和 worker 使用 Node 环境。Vue 组件测试使用 jsdom 和 Vue 插件，不能将 DOM 全局环境注入纯规则测试。测试文件统一为 `tests/**/*.test.ts`，辅助文件同样使用 TypeScript；配置采用 runner loader，支持仓库约定的无后缀配置导入。按子目录分组的项目在 `mergeConfig` 合并后显式替换最终 `test.include`，避免数组拼接保留共享的宽泛模式，导致不同项目重复收集同一批测试。

测试中的跨包引用仍使用公开包名与子路径，由 `configs/typescript/test.json` 的测试专用 paths 和 `configs/vitest/shared.ts` 的相同映射解析到 workspace 源码。生产 TypeScript 配置与 package exports 不启用测试映射。源码测试不依赖旧 dist；根入口和游戏 game/rules/sdk/renderer 标准子路径已有通配映射，engine/node 也有显式源码映射，新增自定义公开子路径需同步增加测试映射。

TypeScript 的 paths、include、exclude 和 rootDir 按声明它们的配置文件位置解析；Vitest 的源码映射也以 `configs/typescript/test.json` 所在位置为基准，避免依赖运行命令时的工作目录。

`pnpm typecheck` 在生产源码检查之外执行测试、辅助文件和配置的严格类型检查；web 的 Vue 测试使用 vue-tsc。确需构造非法输入的测试在明确的 unknown 边界进行断言转换，不通过 any 或关闭 strict 绕过检查。

`pnpm test` 单次运行全仓，`pnpm test:watch` 监听源码与依赖变化，`--project` 按名称筛选，`pnpm test:coverage` 统一输出源码覆盖率至根 coverage 目录。覆盖率包含未执行的业务源码，避免只报告已导入文件。

源码测试与分发验证分别执行。`pnpm test:artifacts` 完成生产构建、公开工具包与开发包内私有游戏模块打包和仓库外解压，检查所有公开 JS/类型入口；再用真实 Node 和严格 NodeNext 消费者验证加载、CLI、完整比赛与编译后的 API。验证进程不使用测试别名或 TS loader，不依赖 workspace 软链接，也不进行发布或正式比赛计分。

## 游戏模块接口

游戏规则实现以下契约；JSON 和结果类型由 protocol 包导出：

```ts
interface GameRules<State, Observation, Action, Event> {
  init(input: InitInput): State;
  observe(
    state: DeepReadonly<State>,
    playerId: string,
    context?: { events: DeepReadonly<Event[]> },
  ): Observation | null;
  parseAction(raw: JsonValue): ActionParseResult<Action>;
  defaultAction(state: DeepReadonly<State>, playerId: string): Action;
  step(
    state: DeepReadonly<State>,
    actions: DeepReadonly<Record<string, Action>>,
  ): {
    nextState: State;
    events: Event[];
    result?: GameResult;
  };
}
```

- `init` 接收固定玩家席位、游戏配置、种子，生成完整初始世界和随机数状态。
- `observe` 返回玩家可见数据；context.events 是上一 tick 结算的冻结事件数组，首 tick 为空，由游戏筛选公开信息；已淘汰或本 tick 不行动时可返回 `null`。
- `parseAction` 验证不可信输入，生成规范动作；格式失败交由运行器记录诊断。
- `defaultAction` 由游戏定义，不允许平台一律假设“向前移动”。
- `step` 一次接收本 tick 所有有效动作与默认动作，生成确定性的下一世界和事件。
- `result` 包括结束原因、结束 tick、各玩家得分与名次；相同名次表示平局。

`DeepReadonly` 由 protocol 导出，对 JSON 对象和数组递归只读。规则不得修改输入世界、动作及其任何嵌套数据，返回新状态或只共享不再修改的结构；开发验收对输入深冻结并检查。类型约束不等同于沙箱，发送玩家观察时仍需复制或序列化；渲染器也不能原地修改回放状态或缓存。

`step` 不获取现实时间、不使用外部网络、不调用玩家代码，不读取平台账号和排位。随机数由状态携带，数组遍历与冲突处理顺序明确规定。

## 模块配置与注册

manifest 包含稳定游戏 ID、展示信息、人数范围、规则发行标识、默认配置、tick 上限和资源限制。圈地固定 2 人、30×30 地图、500 tick，资源数值遵守 [资源限额](resource-limits.md)。游戏在 `limits` 中按字段覆盖平台默认资源预算，未指定的字段继承默认值；发布时生成完整的 `resolvedLimits`，网站、上传 API、沙箱与本地工具读取同一发行配置。游戏模块提供固定、可信的参数 schema。

manifest 的 `botProtocolVersion` 是从 1 开始的整数，标识玩家代码接口兼容性；圈地当前为 2。观察、动作、SDK、Memory 协议或受支持 JS 语法发生不向后兼容的改变时递增。规则平衡、画面与保持旧调用有效的接口扩展不递增。发行标识与协议版本不能互相替代。

代码上传时记录当时的协议版本。新发行只接纳协议版本相同且源码体积合规的选手；不兼容时要求重新上传，兼容升级继续使用原代码，排位均保留。游戏发布先安装不可变规则与开发包，并准备符合新协议的官方 bot，再切换当前发行，保证回退对手可用。不同发行不能共享可变配置对象。

注册采用仓库内显式列表：服务端、worker、网页、本地 CLI 和开发包构建各使用显式可信注册。新增符合现有参赛与计分模式的游戏时添加游戏包并更新注册列表，不修改引擎循环或增加游戏 ID 分支；新增参赛模式需要同步扩展通用协议、平台行为与文档。

首版不支持用户上传游戏模块，不提供远程热加载。游戏包的插件机制服务开发扩展，不给予玩家代码同等权限。

## 玩家 JS 入口

比赛运行器使用 `GameDefinition` 组合可信 manifest、上述 rules、parseConfig、parseState 和 parseObservation。状态解析器接收冻结配置与参赛席位，检查世界中的玩家映射；观察解析器校验当前玩家及 tick，错误观察不得作为玩家失误处理。引擎不加入具体游戏分支。圈地通过 `@si-arena/game-paper/game` 导出定义、SDK 源码与官方 bot 的可信资源位置，根元数据入口仍不加载规则、renderer 或 bot。

`@si-arena/engine` 通过工厂创建各玩家的执行适配器，不依赖 sandbox；适配器验证动作与 Memory，并在失败时保留旧 Memory。核心入口提供比赛与回放逻辑，可供浏览器使用；文件和 gzip 功能只从 `@si-arena/engine/node` 导出。回放使用 ReplaySink 流式追加完整 tick，候选文件生成后仍由 worker 按执行权和数据库事务发布、结算。接口与可运行示例见 [引擎说明](../../packages/engine/README.md)。

CLI 与 worker 通过 runner 共用比赛进程监督，传入显式可信游戏模块入口、冻结源码、配置与发行。runner 在独立比赛进程内组装 engine 和 sandbox，持有世界与已提交 Memory；sandbox 不依赖 engine、账号或数据库，engine 核心不依赖 Node。

玩家代码采用单文件 ESM，同步导出默认函数：

```js
export default function tick({ game, Memory }) {
  Memory.turns = (Memory.turns ?? 0) + 1;
  game.self.move("right");
}
```

`game` 是当前游戏定义的公开视图与基础动作方法，`Memory` 是本场上一成功 tick 的 JSON 数据。圈地仅提供自己的 move/idle；平台不规定地图、方向、角色或动作种类。每个游戏负责自己的命令收集、同单位/动作类型冲突规则及规范 JSON 格式，支持一个玩家控制多个角色；寻路、威胁评估和策略不属于正式 API。

可信 SDK 是沙箱内初始化的自包含 ESM，默认导出 `(observation, { submit, reject }) => game`。每 tick 在玩家执行前调用工厂，以冻结的独立 JSON 观察构建视图并初始化该游戏的默认意图。submit 只保存本 tick 候选规范动作，不跨进程、不立即推进世界；SDK 可在私有集合中累积多角色命令再提交集合。reject 锁定 INVALID_ACTION，catch 后不能恢复提交。动作方法必须使用当前 tick 的提交闭包，旧 tick 的调用不能修改当前候选命令。调用方法和最终序列化属于玩家 CPU；工厂与可信视图构建不计入玩家 CPU，仍受墙钟限制。工厂失败属于系统错误。

入口返回 undefined，包装器在预算内一次性序列化收集到的动作与 Memory；不支持同时返回动作。任何非 undefined 返回值，包括 Promise，均为 ENTRYPOINT_ERROR。所有输出通过原有动作解析器后才提交。

玩家接口 v2 沿用常驻执行：允许全局变量、闭包和 SDK 状态在本场成功 tick 间保留，受同一个常驻堆预算限制；任一执行失败后全部清空，模块重新加载。只有已提交 Memory 是恢复检查点。观察和 Memory 每 tick 独立注入，旧引用不会指向下一 tick 的输入。Memory 初始为 `{}`，每场独立，不能读取其他场次或其他用户的 Memory。上下文根对象只读，Memory 根引用不可替换；玩家通过增删改其属性更新记忆。普通局部变量重新赋值不会替换已注入的 Memory。

Memory 根必须是普通对象或无原型对象，其可枚举数据由有限数字、字符串、布尔值、null、稠密数组和普通对象组成。拒绝循环、undefined、BigInt、函数、Symbol、非有限数字、访问器和 Date/Map 等实例，不允许 JSON.stringify 的静默丢弃或转换替代协议校验。相同对象被多处引用可按 JSON 值展开，展开后的实际字节数受限。

入口同步结束且返回 undefined；返回动作对象、Promise 或其他值为 `ENTRYPOINT_ERROR`。禁止静态 import、导出转发、动态 import 与顶层 await，模块加载器也拒绝导入。V8 微任务在同 tick 内执行并计入相同 CPU 与墙钟预算，不能通过微任务绕过限额；运行器不提供定时器或网络。JS 语法先做 AST 约束检查，再用同版 V8 的模块编译（isolated-vm `compileModule`）校验，编译不执行顶层代码。

SDK 定义游戏的公开事实、基础动作方法与私有意图收集器，不包含寻路或具体策略算法。运行时 SDK 在沙箱内部初始化，不把宿主对象、引擎引用或业务服务方法直接交给玩家。首版上传文件需要自包含，除默认入口外不开放任意模块导入；用户可在本地打包自己的辅助代码。

游戏状态和观察使用同一组严格 JSON 值类型，必须通过游戏 schema。规则引擎检查初始 tick 为 0、每次 step 只推进 1 tick、终局参与者完整且名次与分数合法。每个游戏必须在自己的 maxTicks 内返回 result，越界或违反状态协议视为系统错误，不由平台猜测胜负。

## 说明与 SDK 的一致性

游戏包内维护规则说明、字段类型、限制配置和官方 bot。参赛提示词组合这些内容产生，避免在网站数据库和源码中维护两套规则。

网站显示当前游戏发行信息。所有示例必须能在分发包内运行，官方 bot 与普通代码走同一个入口和资源限制。

## 渲染器接口

renderer 接收当前世界、前一世界、当 tick 事件及动画进度，负责画面和游戏专属面板。播放器提供时间轴、播放速度、玩家列表、错误与本地日志展示。

插值只改变屏幕表现，不反向修改世界。DOM、Canvas、浏览器时间不能进入规则判定。没有动画时也能正常批量运行游戏。

游戏 Canvas renderer 采用深色网格与霓虹材质，区分阵营、领地、尾迹、地形与临时事件；网页回放、参赛工作台和本地工具复用同一实现。大厅仅传入经状态解析器校验的静态展示世界。发光、材质和插值均为表现层，不扩张碰撞范围，不改变世界或回放数据，也不读取现实时间来决定棋盘内容。
