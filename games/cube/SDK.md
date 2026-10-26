# 魔方玩家 API

发行与玩家接口版本见 release.json 的 `game.release` 和 `game.botProtocolVersion`。玩家提交自包含的 UTF-8 JavaScript ESM，默认导出同步函数，每 tick 调用一次：

```js
/** @param {import("@si-arena/game-cube/sdk").CubeTickInput} input */
export default function tick({ game, Memory }) {
  Memory.turns = (typeof Memory.turns === "number" ? Memory.turns : 0) + 1;
  game.self.turn(Memory.turns % 2 === 0 ? "R" : "R'");
}
```

入口返回 `undefined`，通过角色方法登记动作意图。可以直接结束函数或 `return;`，也可以 `return game.self.turn("U")`；不能返回动作对象、Promise 或其他值，否则为 `ENTRYPOINT_ERROR`。JSDoc 的类型引用不会加载模块，玩家运行时禁止 import。

## 基础动作

| 方法                   | 含义                                        |
| ---------------------- | ------------------------------------------- |
| `game.self.turn(move)` | 转动一个面；`move` 必须是 18 个公开名字之一 |

十八个名字是 `U`、`U2`、`U'`、`D`、`D2`、`D'`、`L`、`L2`、`L'`、`R`、`R2`、`R'`、`F`、`F2`、`F'`、`B`、`B2`、`B'`：字母是面，`2` 是 180°，`'` 是逆时针 90°。

未调用动作方法时默认空过（`idle`），不扣分但消耗一 tick。同 tick 多次调用采用最后一次。方法返回 `undefined`，不立即修改魔方；动作在结算时统一执行。转动永远合法，规则不会拒绝任何一步——把魔方转乱也是你自己的选择。

转动名字写错产生 `INVALID_ACTION`，即使玩家 catch 后又调用合法动作，该 tick 也失败。执行异常、超时、CPU/堆/栈、动作或 Memory 超限，同样整体丢弃所有命令和候选 Memory，使用默认空过，保留上次成功的 Memory，并在下一 tick 重建环境。

只有 self 提供动作方法。API 不提供求解、打乱序列或任何搜索辅助；相关算法由玩家实现，官方 bot 的算法在其自身源码中。

## 当前 tick 的公开事实

`game.tick = t` 表示已完成 t 次结算，本次动作参与第 t + 1 次结算。events 是上一轮事件，首 tick 为空，终局后不再调用入口。`game` 每 tick 是全新的只读视图。

| 字段                  | 含义                                        |
| --------------------- | ------------------------------------------- |
| `game.tick`           | 当前输入 tick，从 0 开始                    |
| `game.maxTicks`       | 本局回合上限，固定 400                      |
| `game.facelets`       | 长度 54 的贴纸数组，值 0–5 对应 U R F D L B |
| `game.moves`          | 已走步数；空过不加                          |
| `game.score`          | 当前得分；未还原时恒为 0，还原后为本局成绩  |
| `game.solved`         | 是否已还原；为真时本局立即结束              |
| `game.scrambleLength` | 开局打乱用了多少步；序列本身不公开          |
| `game.events`         | 上一 tick 的公开事件                        |
| `game.self.id`        | 你的玩家 ID                                 |

## 贴纸编号

贴纸按面分块：U 0–8、R 9–17、F 18–26、D 27–35、L 36–44、B 45–53，每块按展开图的行优先顺序排列：

```
        U0 U1 U2
        U3 U4 U5
        U6 U7 U8
L0 L1 L2  F0 F1 F2  R0 R1 R2  B0 B1 B2
L3 L4 L5  F3 F4 F5  R3 R4 R5  B3 B4 B5
L6 L7 L8  F6 F7 F8  R6 R7 R8  B6 B7 B8
        D0 D1 D2
        D3 D4 D5
        D6 D7 D8
```

贴纸的值就是它所属面的序号：`0` U、`1` R、`2` F、`3` D、`4` L、`5` B。还原状态是每个贴纸的值都等于 `floor(下标 / 9)`。中心贴纸（4、13、22、31、40、49）永远不动，可以用它们反推六个面。

转动的作用位置由发行固定：`U` 是俯视顺时针，`R` 是右视顺时针，以此类推。需要精确的贴纸置换表时，用官方 bot 源码里的面片模型或自行从几何推导，不要假设其他魔方实现的编号与本发行一致。

## 事件

| 事件     | 触发                                                      |
| -------- | --------------------------------------------------------- |
| `turn`   | 转动生效：`move` 为转动名，`moves` 为累计步数             |
| `solved` | 还原：`moves` 为总步数，`score` 为本局得分（`turn` 之后） |

空过不产生事件。

## 计分与终局

- 还原得分 = `max(0, 2000 - 10 × 步数)`；20 步 1800 分，200 步 0 分。
- 结束条件：还原或 `tick` 达到 400。没还原记 0 分。结算名次固定为第 1。
- 平台排行榜按历史最高分排名；同一玩家可反复开局刷新纪录。

## Memory 与错误恢复

成功 tick 间可复用全局变量和闭包缓存；任一执行失败后重建环境，只恢复上次成功提交的 JSON Memory。Memory 初始为 `{}`，通过增删改属性更新，重新赋值局部 Memory 变量不会替换提交对象。禁止把函数、Map、TypedArray 或 game 写入 Memory。

动作和 Memory 必须同时成功才提交。失败时改用空过，规则不会替你走一步；这一 tick 只是白白消耗。旧 game 的动作方法不能用于新 tick。

实际资源预算见 release.json。`stackBytes` 为保留字段，不控制执行线程栈大小。console 仅本地捕获；源码与 Memory 不写入回放。
