/**
 * Official example bot for 模拟投资 (investment).
 *
 * Momentum + regime-aware allocation:
 *
 * - Momentum: each asset's recent mean reversion vs. current price decides
 *   the target weight; the bot rebalances toward targets every tick with
 *   bounded order sizes to limit its own market impact.
 * - Regime: bull tilts to risky assets, bear parks wealth in cash
 *   (which earns interest), flat keeps a balanced book.
 * - News: a fresh positive/negative news for an asset nudges its target
 *   up/down for a few ticks (tracked in Memory).
 * - Impact control: never push more than ~8% of its own worth into one
 *   asset in a single tick, since orders move next tick's price.
 * - Cash check: buys are sized to keep cash >= value + fee.
 */
const FEE_BPS = 30; // fee bps
const MAX_SIZE = 1_000_000;

const feeFor = (value) => Math.max(1, Math.ceil((value * FEE_BPS) / 10000));

/** Target weight per asset by regime: [anchor, beam, spark, comet]. */
const TARGETS = {
  bull: [0.15, 0.3, 0.35, 0.2],
  flat: [0.3, 0.3, 0.25, 0.15],
  bear: [0.7, 0.2, 0.1, 0.0],
};

export default ({ game, Memory }) => {
  const { self, assets, regime, tick } = game;

  // News momentum book: asset -> ticks remaining of the nudge.
  if (!Memory.newsTicks) Memory.newsTicks = {};
  for (const asset of assets) {
    if (asset.news && asset.news.tick === tick - 1) {
      Memory.newsTicks[asset.id] = asset.news.positive ? 6 : -6;
    }
  }
  for (const id of Object.keys(Memory.newsTicks)) {
    if (Math.abs(Memory.newsTicks[id]) > 0.5) {
      Memory.newsTicks[id] =
        Memory.newsTicks[id] > 0 ? Memory.newsTicks[id] - 1 : Memory.newsTicks[id] + 1;
    }
  }

  const worth = self.cash + assets.reduce((sum, asset, i) => sum + self.shares[i] * asset.price, 0);
  const base = TARGETS[regime] || TARGETS.flat;

  // Momentum score: current price vs. recent history mean, clamped to [-1, 1].
  const scores = assets.map((asset) => {
    const mean = asset.history.reduce((a, b) => a + b, 0) / asset.history.length;
    const raw = mean === 0 ? 0 : (asset.price - mean) / mean;
    const nudge = (Memory.newsTicks[asset.id] || 0) / 6; // [-1, 1]
    return Math.max(-1, Math.min(1, raw * 12 + nudge * 0.5));
  });

  // Final weights: base tilted by momentum, normalized to <= 1 total.
  const weights = base.map((w, i) => Math.max(0, w * (1 + scores[i] * 0.5)));
  const weightSum = weights.reduce((a, b) => a + b, 0) || 1;
  const scaled = weights.map((w) => (w / Math.max(weightSum, 1)) * Math.min(1, weightSum));

  // Rebalance with bounded order sizes (impact control + cash check).
  assets.forEach((asset, i) => {
    const targetValue = worth * scaled[i];
    const currentValue = self.shares[i] * asset.price;
    const diff = targetValue - currentValue;
    const bounded = Math.max(-worth * 0.08, Math.min(worth * 0.08, diff));
    const quantity = Math.floor(Math.abs(bounded) / asset.price);
    if (quantity < 1 || quantity > MAX_SIZE) return;
    if (bounded > 0) {
      const value = quantity * asset.price;
      if (self.cash >= value + feeFor(value)) self.buy(asset.id, quantity);
    } else if (self.shares[i] > 0) {
      const sell = Math.min(quantity, self.shares[i]);
      if (sell >= 1) self.sell(asset.id, sell);
    }
  });
};
