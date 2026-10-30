/** Trusted guest ESM. This game alone defines its methods and canonical intent. */
export const INVESTMENT_SDK_SOURCE = String.raw`
const ASSETS = ["anchor","beam","spark","comet"];
const SIDES = ["buy","sell"];
const freeze = Object.freeze;
const find = Function.prototype.call.bind(Array.prototype.find);
export default function createGame(observation, {submit, reject}) {
  submit({type:'idle'});
  const me = find(observation.traders, (trader) => trader.id === observation.selfId) || null;
  const assets = freeze(observation.assets.map((asset) => freeze({
    id: asset.id, name: asset.name, price: asset.price,
    history: freeze(asset.history.slice()), news: asset.news,
  })));
  const byId = (id) => find(assets, (asset) => asset.id === id) || null;
  const self = freeze({
    id: observation.selfId, slot: observation.selfSlot,
    cash: me ? me.cash : 0,
    shares: me ? freeze(me.shares.slice()) : freeze([0,0,0,0]),
    fees: me ? me.fees : 0,
    rejected: me ? me.rejected : 0,
    netWorth() {
      let worth = me ? me.cash : 0;
      for (let i = 0; i < ASSETS.length; i++) worth += (me ? me.shares[i] : 0) * observation.assets[i].price;
      return worth;
    },
    buy(asset, quantity) {
      if (ASSETS.indexOf(asset) < 0) reject('Asset must be one of ' + ASSETS.join(' '));
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000000)
        reject('Quantity must be an integer between 1 and 1000000');
      submit({type:'order', asset: asset, side:'buy', quantity: quantity});
    },
    sell(asset, quantity) {
      if (ASSETS.indexOf(asset) < 0) reject('Asset must be one of ' + ASSETS.join(' '));
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000000)
        reject('Quantity must be an integer between 1 and 1000000');
      submit({type:'order', asset: asset, side:'sell', quantity: quantity});
    },
    idle() { submit({type:'idle'}); },
  });
  return freeze({
    tick: observation.tick,
    maxTicks: observation.maxTicks,
    regime: observation.regime,
    assets,
    traders: observation.traders,
    self,
    events: observation.events,
    asset: byId,
    feeFor(value) { return Math.max(1, Math.ceil(value * 30 / 10000)); },
  });
}
`;
