import type { Action } from "../ledger/types";
import { correctionRequestId, fxRequestId, retryRequestId } from "../requestId";
import { round } from "../money";
import { payeeMismatch, type Situation } from "./situation";
import { agentMode, chatJSON, type ChatJSON } from "./openrouter";
import { FLOW_FACTS } from "./wringer";

export interface Plan { summary: string; actions: Action[] }

export interface PlanOptions {
  env?: NodeJS.ProcessEnv;
  chat?: ChatJSON;
}

export const PLANNER_SYSTEM = `You are the Two-Key planner for a payment ops team on Airwallex.
Code has already filed the money moves for this round (retry_transfer, fx_conversion, defer_payout).
You may comment. You cannot add, remove, or renumber moves, and you cannot set ids, amounts, or request_ids.
Reply JSON {"summary": string, "moves": []}. Keep the summary under 400 characters.
${FLOW_FACTS}`;

/** Deterministic stub. Round 1 is the "obvious" plan a hurried operator makes; round 2 answers the Wringer. */
export function stubPlan(s: Situation, round_: number, objections: string[]): Plan {
  const o = s.original;
  const retry = (slot: string): Action => ({
    kind: "retry_transfer", originalTransferId: o.id, amount: o.transfer_amount, currency: o.transfer_currency,
    beneficiaryId: o.beneficiary_id ?? "", reference: o.reference ?? "",
    requestId: retryRequestId(s.intentId, slot, { originalTransferId: o.id, amount: o.transfer_amount, currency: o.transfer_currency, beneficiaryId: o.beneficiary_id ?? "" }),
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
  const c = s.correction;
  const fixed = s.beneficiary && c && s.beneficiary.companyName === c.companyName && s.beneficiary.accountName === c.accountName;
  if (payeeMismatch(o) && c && c.beneficiaryId === o.beneficiary_id && !fixed) {
    actions.unshift({ kind: "correct_beneficiary", beneficiaryId: c.beneficiaryId, companyName: c.companyName, accountName: c.accountName, requestId: correctionRequestId(s.intentId, c.beneficiaryId, c.companyName, c.accountName) });
  }
  let need = o.transfer_amount + s.reserve.amount - usd;
  const deferred = s.queuedPayouts.filter((p) => p.priority === "low" && p.currency === o.transfer_currency);
  for (const p of deferred) {
    actions.push({ kind: "defer_payout", payoutId: p.id, amount: p.amount, currency: p.currency, until: "after supplier settles" });
  }
  need = round(need, o.transfer_currency);
  if (need > 0 && s.quote) {
    actions.unshift({
      kind: "fx_conversion", buyCurrency: s.quote.buy_currency, sellCurrency: s.quote.sell_currency, buyAmount: s.quote.buy_amount,
      quoteId: s.quote.quote_id, quoteValidToAt: s.quote.valid_to_at, requestId: fxRequestId(s.intentId, s.quote.buy_amount, s.quote.buy_currency, s.quote.sell_currency),
    });
  }
  return {
    summary: sentence([
      ...(actions.some((a) => a.kind === "correct_beneficiary") ? [`correct the payee name to ${c!.companyName} as the supplier confirmed`] : []),
      "retry once with a stable request_id",
      ...(actions.some((a) => a.kind === "fx_conversion") ? [`buy ${s.quote!.buy_amount} USD with EUR at the quoted rate`] : []),
      ...(deferred.length ? [`defer ${deferred.length} low-priority payout(s)`] : []),
    ].join(", ")),
    actions,
  };
}

const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;

/** Live path: the model is consulted when OpenRouter is configured. Its `summary` becomes the plan text.
 *  Code still files every move: the model cannot add a retry, change an amount, or choose a request_id.
 *  Round 1 stays the fixture moves so the Wringer still has a double-pay to block. A failed call or a
 *  reply without a usable summary leaves the fixture summary. */
export async function plan(s: Situation, round_: number, objections: string[], opts: PlanOptions = {}): Promise<Plan> {
  const stub = stubPlan(s, round_, objections);
  const env = opts.env ?? process.env;
  if (agentMode(env) !== "llm") return stub;
  try {
    const chat = opts.chat ?? ((role, system, user, callEnv) => chatJSON(role, system, user, callEnv));
    const reply = await chat("planner", PLANNER_SYSTEM, { situation: s, round: round_, objections }, env);
    const summary = modelSummary(reply);
    if (summary) return { summary, actions: stub.actions };
  } catch {
    /* Fixture plan stands. The model never gets a second chance to edit it. */
  }
  return stub;
}

export const MAX_SUMMARY_CHARS = 400;

/** The only field taken from the model. Anything that is not a non-empty string is ignored. */
export function modelSummary(reply: unknown): string | null {
  if (!reply || typeof reply !== "object") return null;
  const raw = (reply as { summary?: unknown }).summary;
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.length > MAX_SUMMARY_CHARS ? `${cleaned.slice(0, MAX_SUMMARY_CHARS - 3)}...` : cleaned;
}
