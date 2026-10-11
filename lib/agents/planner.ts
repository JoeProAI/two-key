import type { Action } from "../ledger/types";
import { stableRequestId } from "../requestId";
import { round } from "../money";
import type { Situation } from "./situation";
import { agentMode, chatJSON } from "./openrouter";

export interface Plan { summary: string; actions: Action[] }

export const PLANNER_SYSTEM = `You are the Two-Key planner for a payment ops team on Airwallex.
Given a JSON situation, propose the smallest set of money moves that gets the failed supplier paid once.
Allowed moves: retry_transfer, fx_conversion (needs a live quote), defer_payout (only low-priority queued payouts).
Never invent ids. Reply JSON {"summary": string, "moves": [{"kind": ..., "amount"?: number, "payoutId"?: string}]}.`;

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
    summary: `Retry once with a stable request_id, buy ${s.quote?.buy_amount ?? 0} USD with EUR at the quoted rate, defer ${deferred.length} low-priority payout(s).`,
    actions,
  };
}

/** LLM path: the model picks moves; code fills every id, amount source, and request_id. */
export async function plan(s: Situation, round_: number, objections: string[]): Promise<Plan> {
  if (agentMode() === "stub") return stubPlan(s, round_, objections);
  const out = await chatJSON<{ summary: string; moves: { kind: string; payoutId?: string }[] }>("planner", PLANNER_SYSTEM, { situation: s, round: round_, objections });
  const base = stubPlan(s, 2, ["llm"]);
  const kinds = new Set(out.moves.map((m) => m.kind));
  return { summary: out.summary, actions: base.actions.filter((a) => kinds.has(a.kind)) };
}
