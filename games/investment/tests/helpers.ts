import { investmentManifest } from "@si-arena/game-investment";
import type {
  InvestmentAction,
  InvestmentAssetId,
  InvestmentState,
} from "@si-arena/game-investment/sdk";
import { investmentRules } from "@si-arena/game-investment/rules";

export const IDS = ["alpha", "beta", "gamma", "delta"] as const;

/** Fail explicitly while narrowing optional values in strict test code. */
export function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Expected a value in the test fixture");
  return value;
}

export const idle = (): InvestmentAction => ({ type: "idle" });
export const order = (
  asset: InvestmentAssetId,
  side: "buy" | "sell",
  quantity: number,
): InvestmentAction => ({ type: "order", asset, side, quantity });

export function init(seed = 0, players: readonly string[] = IDS.slice(0, 2)): InvestmentState {
  return investmentRules.init({
    seed,
    config: { ...investmentManifest.config },
    players: players.map((id, slot) => ({ id, slot })),
  });
}

export function step(
  state: InvestmentState,
  actions: Record<string, InvestmentAction> = {},
): ReturnType<typeof investmentRules.step> {
  return investmentRules.step(
    state,
    Object.fromEntries(Object.keys(actions).map((id) => [id, actions[id] ?? idle()])),
  );
}

/** 深冻结状态，验证 step 不修改输入世界。 */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Reflect.ownKeys(value as object)) {
      deepFreeze((value as Record<symbol | string, unknown>)[key as string]);
    }
    Object.freeze(value);
  }
  return value;
}

export const cashs = (state: InvestmentState) => state.traders.map((trader) => trader.cash);
export const sharesOf = (state: InvestmentState, asset: number) =>
  state.traders.map((trader) => trader.shares[asset]);
export const pricesOf = (state: InvestmentState) => [...state.prices];
