/**
 * Official example bot for 弹幕对决 (danmaku).
 *
 * Inertial movement and slow/fast bullets:
 *
 * - Dodge: simulates every (move) input one tick ahead - velocity carries
 *   over, so the bot predicts where it will drift - and scores the resulting
 *   cell against all bullets' swept cells and wall proximity.
 * - Fire: leads the opponent's predicted cell using their observed velocity,
 *   choosing the 16-direction lattice line passing closest. Fast shots (4
 *   cells/tick) when the predicted error is small, slow shots (2 cells/tick)
 *   to weave.
 * - Positioning: keeps a preferred duel range, and brakes (hold) when
 *   drifting would carry it into a bullet.
 * - Memory: nothing needs to persist across ticks; the bot only reads the
 *   current view, so a lost Memory never breaks it.
 */
const chebyshev = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const DX = {
  E: [1, 0],
  NE: [1, -1],
  N: [0, -1],
  NW: [-1, -1],
  W: [-1, 0],
  SW: [-1, 1],
  S: [0, 1],
  SE: [1, 1],
};
/** Base per-tick displacement of a slow bullet; fast bullets move twice. */
const SHOT = {
  E: [2, 0],
  ENE: [2, -1],
  NE: [2, -2],
  NNE: [1, -2],
  N: [0, -2],
  NNW: [-1, -2],
  NW: [-2, -2],
  WNW: [-2, -1],
  W: [-2, 0],
  WSW: [-2, 1],
  SW: [-2, 2],
  SSW: [-1, 2],
  S: [0, 2],
  SSE: [1, 2],
  SE: [2, 2],
  ESE: [2, 1],
};
/** Cells swept per tick by each speed tier (the rules sample every one). */
const SPEED_CELLS = { slow: 2, fast: 4 };
/** Per-tick multiplier over the base table for each speed tier. */
const SPEED_MULT = { slow: 1, fast: 2 };
const MOVES = Object.keys(DX).concat(["hold"]);

export default ({ game }) => {
  const { self, opponent, bullets, width, height } = game;
  const free = (x, y) => x >= 0 && y >= 0 && x < width && y < height;

  // Where a ship with velocity (vx, vy) and input move ends up next tick.
  const nextCell = (position, velocity, move) => {
    let vx = velocity.x;
    let vy = velocity.y;
    if (move === "hold") return { x: position.x, y: position.y, vx: 0, vy: 0 };
    const a = move === null ? [0, 0] : DX[move];
    vx = clamp(vx + a[0], -1, 1);
    vy = clamp(vy + a[1], -1, 1);
    let x = position.x;
    let y = position.y;
    for (let i = 0; i < Math.abs(vx); i++) {
      if (!free(x + Math.sign(vx), y)) {
        vx -= Math.sign(vx);
        break;
      }
      x += Math.sign(vx);
    }
    for (let i = 0; i < Math.abs(vy); i++) {
      if (!free(x, y + Math.sign(vy))) {
        vy -= Math.sign(vy);
        break;
      }
      y += Math.sign(vy);
    }
    return { x, y, vx, vy };
  };

  // Every bullet's swept cells next tick (slow: 2 cells, fast: 4 cells),
  // walked proportionally exactly like the rules.
  const danger = [];
  for (const bullet of bullets) {
    if (bullet.owner === self.slot) continue;
    const [dx, dy] = SHOT[bullet.direction];
    const cells = SPEED_CELLS[bullet.speed];
    for (let k = 1; k <= cells; k++)
      danger.push([
        bullet.position.x + Math.floor((dx * k) / 2),
        bullet.position.y + Math.floor((dy * k) / 2),
      ]);
  }
  const threatened = (x, y) => danger.some(([bx, by]) => chebyshev(bx, by, x, y) <= 1);

  // ── Movement: score each input by survival, then spacing heuristics. ──
  const distance = chebyshev(
    self.position.x,
    self.position.y,
    opponent.position.x,
    opponent.position.y,
  );
  let best = null;
  for (const move of MOVES) {
    const cell = nextCell(self.position, self.velocity, move);
    let score = 0;
    if (threatened(cell.x, cell.y)) score -= 1000;
    // Staying drift-safe is worth more than open space.
    if (cell.x !== self.position.x || cell.y !== self.position.y) score += 10;
    // Prefers the 5..11 duel band; farther targets close in, closer retreats.
    const nextDistance = chebyshev(cell.x, cell.y, opponent.position.x, opponent.position.y);
    score -= Math.abs(nextDistance - 8) * 3;
    // Slight wall repulsion so inertia does not grind into corners.
    const wall = Math.min(cell.x, cell.y, width - 1 - cell.x, height - 1 - cell.y);
    score -= wall === 0 ? 60 : wall === 1 ? 15 : 0;
    // Strafe off the opponent's exact lattice lines.
    const ox = cell.x - opponent.position.x;
    const oy = cell.y - opponent.position.y;
    if (ox === 0 || oy === 0 || Math.abs(ox) === Math.abs(oy)) score -= 12;
    if (best === null || score > best.score) best = { move, cell, score };
  }
  const chosen = best;

  // ── Fire: lead the opponent's drift by the shot's flight time. ───────
  let fire = null;
  let speed = "slow";
  if (distance <= 16) {
    let aim = null;
    for (const [name, [dx, dy]] of Object.entries(SHOT)) {
      for (const [tier, mult] of Object.entries(SPEED_MULT)) {
        // 慢弹每 tick 走基准表，快弹两倍；沿弹道逐 tick 扫到墙为止，
        // 按弹丸到达第 i+1 tick 时对手的惯性漂移位置引导瞄准。
        let x = self.position.x;
        let y = self.position.y;
        for (let i = 0; i < 9; i++) {
          x += dx * mult;
          y += dy * mult;
          if (!free(x, y)) break;
          const lead = clamp(opponent.position.x + opponent.velocity.x * (i + 1), 0, width - 1);
          const leadY = clamp(opponent.position.y + opponent.velocity.y * (i + 1), 0, height - 1);
          const error = chebyshev(x, y, lead, leadY);
          if (aim === null || error < aim.error) aim = { name, error, tier };
        }
      }
    }
    if (aim !== null && aim.error <= 1) {
      fire = aim.name;
      speed = aim.tier;
    }
  }

  const inputs = { move: chosen.move, fire, speed };
  game.self.act(inputs.move, inputs.fire, inputs.speed);
};
