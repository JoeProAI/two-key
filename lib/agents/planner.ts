import type { Action } from "../ledger/types";
import { stableRequestId } from "../requestId";
import { round } from "../money";
import type { Situation } from "./situation";
import { agentMode, chatJSON, type ChatJSON } from "./openrouter";

export interface Plan { summary: string; actions: Action[] }

export interface PlanOptions {
  env?: NodeJS.ProcessEnv;
  chat?: ChatJSON;
}

export const PLANNER_SYSTEM = `You are the Two-Key planner for a payment ops team on Airwallex.
Code has already filed the money moves for this round (retry_transfer, fx_conversion, defer_payout).
You may comment. You cannot add, remove, or renumber moves, and you cannot set ids, amounts, or request_ids.
Reply JSON {"summary": string, "moves": []}.`;

/** Deterministic stub. Round 1 is the "obvious" plan a hurried operator makes; round 2 answers the Wringer. */
export function stubPlan(s: Situation, round_: number, objections: string[]): Plan {
  const o = s.original;
  const retry = (slot: string): Action => ({
    kind: "retry_transfer", originalTransferId: o.id, amount: o.transfer_amount, currency: o.transfer_currency,
    beneficiaryId: o.beneficiary_id ?? "", reference: o.reference ?? "", requestId: stableRequestId(s.intentId, "retry_transfer", slot),
  });
  if (round_ === 1 || objections.length === 0) {
    // Naive: one retry per failed webhook delivery received.
    return {
      summary: `Retry ${o.transfer_currency} ${o.transfer_amount} to the supplier (${s.webhook.failedDeliveries} failure notices received).`,
      actions: Array.from({ length: s.webhook.failedDeliveries }, (_, i) => retry(String(i))),
    };
  }
  const usd = s.balances.find((b) => b.currency === o.transfer_currency)?.available_amount ?? 0;
  const actions: Action[] = [retry("0")];
  let need = o.transfer_amount + s.reserve.amount - usd;
  const deferred = s.queuedPayouts.filter((p) => p.priority === "low" && p.currency === o.transfer_currency);
  for (const p of deferred) {
    actions.push({ kind: "defer_payout", payoutId: p.id, amount: p.amount, currency: p.currency, until: "after supplier settles" });
  }
  need = round(need, o.transfer_currency);
  if (need > 0 && s.quote) {
    actions.unshift({
      kind: "fx_conversion", buyCurrency: s.quote.buy_currency, sellCurrency: s.quote.sell_currency, buyAmount: s.quote.buy_amount,
      quoteId: s.quote.quote_id, quoteValidToAt: s.quote.valid_to_at, requestId: stableRequestId(s.intentId, "fx_conversion"),
    });
  }
  return {
    summary: [
      "Retry once with a stable request_id",
      ...(actions.some((a) => a.kind === "fx_conversion") ? [`buy ${s.quote!.buy_amount} USD with EUR at the quoted rate`] : []),
      ...(deferred.length ? [`defer ${deferred.length} low-priority payout(s)`] : []),
    ].join(", ") + ".",
    actions,
  };
}

/** Live path: the model is consulted when OpenRouter is configured. Code still files every move.
 *  The model cannot add a retry, change an amount, or choose a request_id. Round 1 stays the
 *  fixture plan so the Wringer still has a double-pay to block. A failed call leaves the fixture. */
export async function plan(s: Situation, round_: number, objections: string[], opts: PlanOptions = {}): Promise<Plan> {
  const stub = stubPlan(s, round_, objections);
  const env = opts.env ?? process.env;
  if (agentMode(env) !== "llm") return stub;
  try {
    const chat = opts.chat ?? ((role, system, user, callEnv) => chatJSON(role, system, user, callEnv));
    await chat("planner", PLANNER_SYSTEM, { situation: s, round: round_, objections }, env);
  } catch {
    /* Fixture plan stands. The model never gets a second chance to edit it. */
  }
  return stub;
}
