---
"@si-arena/game-danmaku": minor
---

弹幕对决 0.2.0（botProtocolVersion 2，不兼容升级）：移动改为惯性（move 是加速度、速度跨 tick 保留、hold 刹车），弹幕分快慢两档（慢弹每 tick 2 格、快弹 4 格，均严过机体满速 1 格，路径逐格采样），出生点由 seed 从中心对称布局表抽取，生命 5→100。动作新增 speed 字段与 hold 输入，观察与状态新增 velocity、layout；同 tick 多发超杀伤害钳制在 0。
