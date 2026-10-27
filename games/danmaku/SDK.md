# 弹幕对决玩家 API

玩家接口 v2。游戏发行、接口版本和资源限制分别见 `release.json` 的 `game.release`、`game.botProtocolVersion` 和 `game.resolvedLimits`。完整玩法与研究流程见 PROMPT.md。

## 最小入口

将所有代码写在一个 UTF-8 JavaScript 文件中，用 ESM 默认导出同步函数。每 tick 调用一次。下面演示入口、Memory 和动作方法，不是完整的对战策略：

```js
/** @param {import("@si-arena/game-danmaku/sdk").DanmakuTickInput} input */
export default function tick({ game, Memory }) {
  Memory.turns = (typeof Memory.turns === "number" ? Memory.turns : 0) + 1;
  const { self, opponent } = game;
  // move 是加速度：持续按住会加速到每轴 ±1，松手与 idle 继续漂移，hold 才能刹车。
  const dx = opponent.position.x - self.position.x;
  const dy = opponent.position.y - self.position.y;
  const shot = dy < 0 ? "N" : dy > 0 ? "S" : dx < 0 ? "W" : "E";
  // 第三参选弹速："slow" 每 tick 2 格织网，"fast" 每 tick 4 格点杀。
  game.self.act(dx > 2 ? "E" : dx < -2 ? "W" : null, shot, "slow");
}
```

入口返回 `undefined`，通过动作方法选择本 tick 的动作。可以直接结束函数或 `return;`；不能返回动作对象、Promise 或其他值，否则为 `ENTRYPOINT_ERROR`。JSDoc 的类型引用不会加载模块，玩家运行时禁止 import。

## 基础动作

| 方法                               | 含义                                                                                                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `game.self.act(move, fire, speed)` | 一次性登记移动与开火。`move` 为 `"E" "NE" "N" "NW" "W" "SW" "S" "SE" "hold"` 之一或 `null`；`fire` 为 16 向弹幕方向之一或 `null`；`speed` 为 `"slow"` 或 `"fast"` |
| `game.self.move(direction)`        | 等价 `act(direction, null)`：只移动                                                                                                                               |
| `game.self.fire(direction, speed)` | 等价 `act(null, direction, speed)`：只开火；`speed` 缺省 `"slow"`                                                                                                 |
| `game.self.idle()`                 | 登记放弃行动                                                                                                                                                      |

未调用动作方法时默认 idle。同 tick 多次调用采用最后一次，这些方法相互覆盖。它们返回 `undefined`，不立即修改位置；双方执行结束后统一结算。

**移动是惯性**：`move` 输入的是本 tick 的加速度，速度每轴钳制在 ±1 并跨 tick 保留；位置按 `速度 + 加速度` 逐格位移。`null` 表示不施加加速度（继续漂移），`"hold"` 表示刹车（速度立即清零、位置不变）。`idle()` 或本 tick 执行失败时同样不施加加速度——机体按现有速度继续漂移，急停只能靠 `hold`。撞到边界的那一步不移动、该轴速度分量回退并发一次 `blocked` 事件；机体可以与对手同格或互换位置。在飞弹幕已满 3 发时开火无效（无事件、不惩罚）。

方向或速度参数错误会产生 `INVALID_ACTION`，即使用 catch 捕获后再调用合法动作，本 tick 仍执行失败。执行异常、超时或资源超限时，也会丢弃本 tick 的动作和 Memory 修改，改用 idle，保留上次成功的 Memory，并在下一 tick 重建环境。

只有 self 提供动作方法，opponent 仅供读取。API 不提供寻路、弹道预测或躲避策略；相关算法由玩家实现，官方 bot 的算法在其自身源码中。

## 当前 tick 的数据

`game.tick = t` 表示已完成 t 次结算，本次动作参与第 t + 1 次结算。`game.events` 是上次结算的事件，tick 0 时为空。比赛结束后不再调用入口，最终结果从 CLI 输出或回放查看。

`game` 是本 tick 的只读数据。坐标原点左上，向右 x 增大、向下 y 增大，全部为整数格。

| 字段            | 含义                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------- |
| `game.tick`     | 已完成的结算次数，从 0 开始                                                                                           |
| `game.maxTicks` | 本局回合上限，固定 600                                                                                                |
| `game.width`    | 战场宽度，固定 32                                                                                                     |
| `game.height`   | 战场高度，固定 24                                                                                                     |
| `game.self`     | 自己的 `id`、`slot`、`position: {x,y}`、`velocity: {x,y}`、`hp`（0–100），以及上述四个动作方法                        |
| `game.opponent` | 对方的 `id`、`slot`、`position`、`velocity`、`hp`；本游戏没有中途阵亡，始终是对象                                     |
| `game.bullets`  | 在飞弹幕数组，按发射先后排列，每项含 `serial`、`position`、`direction`、`speed`（`"slow"`/`"fast"`）、`owner`（席位） |
| `game.events`   | 上一 tick 结算产生的公开事件，tick 0 为空数组                                                                         |

慢弹每 tick 沿 16 向基准位移表走 2 格（表见 SDK 常量），快弹走两倍 4 格，两档弹速都严过机体满速的 1 格；路径逐格采样，命中判定为与机体切比雪夫距离 ≤ 1，弹幕不会命中发射者本人，出界即消失。内部 `rngState` 不属于玩家 API，且规则只在初始化用它抽取出生点布局；策略随机数由玩家用可复现算法维护。

game 中的数据均已冻结，不能修改。保存旧 game 或角色引用不会获得下一 tick 的数据；调用旧引用上的动作方法会产生 `INVALID_ACTION`。可以缓存自己的计算结果，但每 tick 都要读取当前传入的 game。

## 公开事件

事件按移动、开火、命中、击毁的顺序排列；移动、开火按席位顺序，命中按弹幕发射顺序。

| type        | 其他字段                                                                              |
| ----------- | ------------------------------------------------------------------------------------- |
| `move`      | `playerId`, `from`, `to`                                                              |
| `blocked`   | `playerId`, `position`（原地）                                                        |
| `fire`      | `playerId`, `position`（发射格）, `direction`, `speed`                                |
| `hit`       | `playerId`（被击中者）, `attackerId`, `position`, `hp`（命中后剩余生命，最低 0）      |
| `destroyed` | `playerId`, `attackerId`, `position`, `serials`（本 tick 命中并终结该机体的弹幕序号） |

## Memory 与资源

`Memory` 是 JSON 恢复检查点：本 tick 对它的全部修改先记在副本上，动作成功提交后整体生效；执行失败则回退到上一 tick 的内容。它必须是纯 JSON 数据（不要放函数或循环引用），大小计入资源限额的 memory 字段。

每 tick 资源限制见 `release.json` 的 `game.resolvedLimits`（CPU 毫秒、内存、输出字节）。正常策略远用不满；被限额打断的 tick 按 idle 处理且 Memory 回退。
