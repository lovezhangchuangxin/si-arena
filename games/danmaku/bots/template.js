/**
 * 弹幕对决玩家模板。
 *
 * 每次 tick 会以 `{ game, Memory }` 调用本文件导出的默认函数：
 * - `game.self` / `game.opponent`：双方位置、速度与生命；
 * - `game.bullets`：全部在飞弹幕（含方向、速度档、所有者）；
 * - `game.events`：上一 tick 的公开事件；
 * - `Memory`：跨 tick 的 JSON 检查点，直接改写它的字段即可持久化。
 *
 * 通过 `self.act(move, fire, speed)` 提交动作：
 * - move 是 E/NE/N/NW/W/SW/S/SE 之一、`hold`（刹车）或 null（维持漂移）；
 *   注意 move 是加速度，速度会累积，松手后机体继续滑行。
 * - fire 是 16 个弹幕方向之一或 null；speed 是 `slow`（每 tick 2 格）或
 *   `fast`（每 tick 4 格），两档都严过机体满速的 1 格。
 * `self.idle()` 表示放弃行动。必须同步返回 undefined，动作只能通过 SDK 方法提交。
 */
export default ({ game }) => {
  // 示例：预测对手漂移位置开慢弹，自己向对手漂移。替换成你自己的策略。
  const { self, opponent } = game;
  // 对手按当前速度漂移后的预测位置。
  const px = opponent.position.x + opponent.velocity.x;
  const py = opponent.position.y + opponent.velocity.y;
  const dx = px - self.position.x;
  const dy = py - self.position.y;
  // move 是加速度：持续按住 E 会加速到每 tick 2 格，hold 才能停下。
  const move = dx > 1 ? "E" : dx < -1 ? "W" : dy > 1 ? "S" : dy < -1 ? "N" : "hold";
  // 按预测点在哪个象限选一个 16 向弹幕方向（示例精度有限，欢迎改进）。
  const shot =
    dy <= -4
      ? dx < 0
        ? "WNW"
        : dx > 0
          ? "ENE"
          : "N"
      : dy >= 4
        ? dx < 0
          ? "WSW"
          : dx > 0
            ? "ESE"
            : "S"
        : dx < 0
          ? "W"
          : "E";
  self.act(move, shot, "slow");
};
