import type { ActionParseResult } from "@si-arena/protocol";
import type { InvestmentAction } from "../sdk";
import { INVESTMENT_ASSET_IDS, INVESTMENT_CONFIG } from "../constants";
import { readRecord } from "./validation";

const SIDES = ["buy", "sell"] as const;

export function parseInvestmentAction(raw: unknown): ActionParseResult<InvestmentAction> {
  try {
    if (raw === null || typeof raw !== "object") throw new TypeError("Action must be an object");
    if ((raw as { type?: unknown }).type === "idle") {
      readRecord(raw, ["type"], "idle action");
      return { ok: true, action: { type: "idle" } };
    }
    const order = readRecord(raw, ["type", "asset", "side", "quantity"], "order action");
    if (order.type !== "order") throw new TypeError("Action must be idle or order");
    if (!INVESTMENT_ASSET_IDS.includes(order.asset as (typeof INVESTMENT_ASSET_IDS)[number]))
      throw new TypeError(`asset must be one of ${INVESTMENT_ASSET_IDS.join(" ")}`);
    if (!SIDES.includes(order.side as (typeof SIDES)[number]))
      throw new TypeError("side must be buy or sell");
    if (
      typeof order.quantity !== "number" ||
      !Number.isInteger(order.quantity) ||
      order.quantity < 1 ||
      order.quantity > INVESTMENT_CONFIG.maxOrderSize
    )
      throw new TypeError(
        `quantity must be an integer between 1 and ${INVESTMENT_CONFIG.maxOrderSize}`,
      );
    return {
      ok: true,
      action: {
        type: "order",
        asset: order.asset as (typeof INVESTMENT_ASSET_IDS)[number],
        side: order.side as "buy" | "sell",
        quantity: order.quantity,
      },
    };
  } catch (error) {
    return { ok: false, message: error instanceof TypeError ? error.message : "Invalid action" };
  }
}
