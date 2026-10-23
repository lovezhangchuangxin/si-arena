# 俄罗斯方块玩家 API

当前发行为 `tetris@0.1.0`、玩家接口 v1。玩家提交自包含的 UTF-8 JavaScript ESM，默认导出同步函数，每 tick 调用一次：

```js
/** @param {import("@si-arena/game-tetris/sdk").TetrisTickInput} input */
export default function tick({ game, Memory }) {
  Memory.pieces = (typeof Memory.pieces === "number" ? Memory.pieces : 0) + 1;
  if (game.piece.x < 4) game.self.move("right");
  else game.self.drop();
}
```

入口返回 `undefined`，通过角色方法登记动作意图。可以直接结束函数或 `return;`，也可以 `return game.self.drop()`；不能返回动作对象、Promise 或其他值，否则为 `ENTRYPOINT_ERROR`。JSDoc 的类型引用不会加载模块，玩家运行时禁止 import。

## 基础动作

| 方法                         | 含义                                                  |
| ---------------------------- | ----------------------------------------------------- |
| `game.self.move(direction)`  | 向 `"left"`、`"right"` 或 `"down"` 移动一格           |
| `game.self.rotate(rotation)` | 顺时针 `"cw"` 或逆时针 `"ccw"` 旋转 90°（带水平踢墙） |
| `game.self.drop()`           | 硬降到底并立即锁定                                    |

未调用动作方法时默认静止（`idle`）。同 tick 多次调用采用最后一次。方法返回 `undefined`，不立即修改棋盘；动作在所有结算前统一登记。移动/旋转撞墙或重叠属于有效意图，由规则判定为无效（无副作用），不由 API 自动避险；`down` 在触底时同样无效。

方向或旋转字面量错误产生 `INVALID_ACTION`，即使玩家 catch 后又调用合法动作，该 tick 也失败。执行异常、超时、CPU/堆/栈、动作或 Memory 超限，同样整体丢弃所有命令和候选 Memory，使用默认静止，保留上次成功的 Memory，并在下一 tick 重建环境。

只有 self 提供动作方法。API 不提供落点搜索、消行预测或堆叠评估；相关算法由玩家实现，官方 bot 的算法在其自身源码中。

## 当前 tick 的公开事实

`game` 每 tick 是全新的只读视图。坐标原点左上，向右 x 增大、向下 y 增大。

| 字段                                       | 含义                                                             |
| ------------------------------------------ | ---------------------------------------------------------------- |
| `game.tick`                                | 当前输入 tick，从 0 开始                                         |
| `game.maxTicks`                            | 本局回合上限，固定 1500                                          |
| `game.board.width` / `game.board.height`   | 场地尺寸，固定 10 / 20                                           |
| `game.board.cells`                         | 长度 200 的数组，行优先；0 为空，1–7 为已锁定方块的类型          |
| `game.piece`                               | 当前方块 `{ type, rotation, x, y }`，type 1–7 对应 I O T S Z J L |
| `game.next`                                | 下一块的 type                                                    |
| `game.lines` / `game.score` / `game.level` | 已消行数、当前得分、当前等级（1 + lines/10）                     |
| `game.fallInterval`                        | 当前等级的重力间隔（tick），12 - (level - 1)，最低 1             |
| `game.events`                              | 上一 tick 的公开事件                                             |
| `game.self.id`                             | 你的玩家 ID                                                      |

`game.board.cells` 只包含已锁定的格子；当前下落方块的格子不在其中，需要用 `game.piece` 自行叠加。方块形状由 `(type, rotation)` 决定，形状表随开发包发布（`SHAPES`），与官方实现一致。

## 事件

| 事件              | 触发                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------- |
| `spawn`           | 新方块出生（含开局首块）                                                                |
| `move` / `rotate` | 你的移动/旋转生效                                                                       |
| `hard-drop`       | 硬降：`cells` 为下落格数，不计分                                                        |
| `lock`            | 锁定：`piece` 为类型，`lines` 为消行数，`rows` 为被消的行号，`gain` 为得分（行数×等级） |
| `level-up`        | 消满 10 行升级：`level` 为新等级                                                        |
| `top-out`         | 新块放不下，本局结束                                                                    |

## 计分与终局

- 消行得分 = 消行数 × 当前等级（1 行 = 1×等级 … 4 行同消 = 4×等级）；软降、硬降不计分。
- 结束条件：top-out 或 `tick` 达到 1500。结算名次固定为第 1，得分为 `score`。
- 平台排行榜按历史最高分排名；同一玩家可反复开局刷新纪录。
