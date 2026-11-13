import type { Action } from "../ledger/types";
import { correctionRequestId, fxRequestId, retryRequestId } from "../requestId";
import { round } from "../money";
import { payeeMismatch, type Situation } from "./situation";
import { agentMode, chatJSON, type ChatJSON } from "./openrouter";
import { FLOW_FACTS, type Finding } from "./wringer";

/** Who wrote the moves: the fixture planner (stub mode), the live model, or the fixture after the model's reply was refused. */
export type PlanSource = "stub" | "model" | "fallback";

export interface Plan { summary: string; actions: Action[]; source: PlanSource; fallbackReason?: string }

export interface PlanOptions {
  env?: NodeJS.ProcessEnv;
  chat?: ChatJSON;
  /** The previous round's findings, so the model can revise. */
  findings?: Finding[];
}

export const MAX_MOVES = 6;

export const PLANNER_SYSTEM = `You are the Two-Key planner for a payment ops team on Airwallex.
Propose the money moves for this round from a closed set. Reply JSON only:
{"summary": string, "moves": Move[]}
Move is one of:
{"kind":"correct_beneficiary","beneficiaryId":string,"companyName":string,"accountName":string}
{"kind":"fx_conversion","buyCurrency":string,"sellCurrency":string,"buyAmount":number}
{"kind":"retry_transfer","amount":number,"currency":string,"beneficiaryId":string}
{"kind":"defer_payout","payoutId":string}
Rules code enforces (a move that breaks one is blocked, a reply that breaks the schema is discarded):
- Code computes every request_id, quote id and payout amount. Do not send them; they are ignored.
- At most ${MAX_MOVES} moves, at most one fx_conversion and one correct_beneficiary.
- fx_conversion must match situation.quote (buy and sell currency, buyAmount = situation.quote.buy_amount).
- retry_transfer must match the original: amount situation.original.transfer_amount, currency situation.original.transfer_currency, beneficiaryId situation.original.beneficiary_id. One retry only.
- correct_beneficiary must use exactly situation.correction (beneficiaryId, companyName, accountName).
- defer_payout takes a payoutId from situation.queuedPayouts.
- After all moves, situation.reserve.currency must stay at or above situation.reserve.amount once queued payouts that are not deferred are paid.
If previousFindings has blocks, revise the moves so each block is answered. Keep the summary under 400 characters.
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
      source: "stub",
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
    source: "stub",
  };
}

const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;

/** Live path: the model proposes the moves from the closed set. `modelMoves` checks the shape strictly and
 *  rebuilds every action from the situation: request ids, quote ids and payout amounts come from code.
 *  The Wringer's hard checks then run on the model's own moves. A failed call or a reply that breaks the
 *  schema is discarded and the fixture moves for this round stand, marked as fallback. */
export async function plan(s: Situation, round_: number, objections: string[], opts: PlanOptions = {}): Promise<Plan> {
  const stub = stubPlan(s, round_, objections);
  const env = opts.env ?? process.env;
  if (agentMode(env) !== "llm") return stub;
  let reason = "model call failed";
  try {
    const chat = opts.chat ?? ((role, system, user, callEnv) => chatJSON(role, system, user, callEnv));
    const previousFindings = (opts.findings ?? []).map((f) => ({ check: f.check, severity: f.severity, detail: f.detail }));
    const reply = await chat("planner", PLANNER_SYSTEM, { situation: s, round: round_, previousFindings }, env);
    const moves = modelMoves(reply, s);
    if (moves.ok) return { summary: modelSummary(reply) ?? describeMoves(moves.actions), actions: moves.actions, source: "model" };
    reason = moves.reason;
  } catch (e) {
    reason = `model call failed: ${e instanceof Error ? e.message.slice(0, 120) : "error"}`;
  }
  return { ...stub, source: "fallback", fallbackReason: reason };
}

type MovesResult = { ok: true; actions: Action[] } | { ok: false; reason: string };

const CURRENCY = /^[A-Z]{3}$/;
const isText = (v: unknown, max = 140): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max && !/\p{Cc}/u.test(v);
const isAmount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1e12;

/** Strict schema for the model's moves. Unknown kinds, missing or mistyped fields, unknown payout ids, or too
 *  many moves reject the whole reply. Any id the model sends is ignored: code computes it. */
export function modelMoves(reply: unknown, s: Situation): MovesResult {
  if (!reply || typeof reply !== "object") return { ok: false, reason: "reply is not an object" };
  const moves = (reply as { moves?: unknown }).moves;
  if (!Array.isArray(moves) || moves.length === 0) return { ok: false, reason: "moves missing or empty" };
  if (moves.length > MAX_MOVES) return { ok: false, reason: `more than ${MAX_MOVES} moves` };
  const o = s.original;
  const actions: Action[] = [];
  let retrySlot = 0;
  for (const [i, m] of moves.entries()) {
    if (!m || typeof m !== "object") return { ok: false, reason: `move ${i} is not an object` };
    const v = m as Record<string, unknown>;
    if (v.kind === "retry_transfer") {
      if (!isAmount(v.amount) || !isText(v.currency, 3) || !CURRENCY.test(v.currency) || !isText(v.beneficiaryId, 64)) return { ok: false, reason: `move ${i} retry_transfer fields` };
      const key = { originalTransferId: o.id, amount: v.amount, currency: v.currency, beneficiaryId: v.beneficiaryId };
      actions.push({ kind: "retry_transfer", ...key, reference: o.reference ?? "", requestId: retryRequestId(s.intentId, String(retrySlot++), key) });
    } else if (v.kind === "fx_conversion") {
      if (!isAmount(v.buyAmount) || !isText(v.buyCurrency, 3) || !CURRENCY.test(v.buyCurrency) || !isText(v.sellCurrency, 3) || !CURRENCY.test(v.sellCurrency)) return { ok: false, reason: `move ${i} fx_conversion fields` };
      if (!s.quote) return { ok: false, reason: `move ${i} fx_conversion without a quote in the situation` };
      if (actions.some((a) => a.kind === "fx_conversion")) return { ok: false, reason: "more than one fx_conversion" };
      actions.push({
        kind: "fx_conversion", buyCurrency: v.buyCurrency, sellCurrency: v.sellCurrency, buyAmount: v.buyAmount,
        quoteId: s.quote.quote_id, quoteValidToAt: s.quote.valid_to_at, requestId: fxRequestId(s.intentId, v.buyAmount, v.buyCurrency, v.sellCurrency),
      });
    } else if (v.kind === "correct_beneficiary") {
      if (!isText(v.beneficiaryId, 64) || !isText(v.companyName) || !isText(v.accountName)) return { ok: false, reason: `move ${i} correct_beneficiary fields` };
      if (actions.some((a) => a.kind === "correct_beneficiary")) return { ok: false, reason: "more than one correct_beneficiary" };
      actions.push({ kind: "correct_beneficiary", beneficiaryId: v.beneficiaryId, companyName: v.companyName, accountName: v.accountName, requestId: correctionRequestId(s.intentId, v.beneficiaryId, v.companyName, v.accountName) });
    } else if (v.kind === "defer_payout") {
      const p = s.queuedPayouts.find((q) => q.id === v.payoutId);
      if (!p) return { ok: false, reason: `move ${i} defer_payout names an unknown payout` };
      if (actions.some((a) => a.kind === "defer_payout" && a.payoutId === p.id)) return { ok: false, reason: `payout ${p.id} deferred twice` };
      actions.push({ kind: "defer_payout", payoutId: p.id, amount: p.amount, currency: p.currency, until: "after supplier settles" });
    } else {
      return { ok: false, reason: `move ${i} has unknown kind` };
    }
  }
  return { ok: true, actions };
}

function describeMoves(actions: Action[]): string {
  return sentence(actions.map((a) => a.kind === "retry_transfer" ? `retry ${a.currency} ${a.amount}`
    : a.kind === "fx_conversion" ? `buy ${a.buyAmount} ${a.buyCurrency} with ${a.sellCurrency}`
    : a.kind === "correct_beneficiary" ? `correct the payee name to ${a.companyName}`
    : `defer ${a.payoutId}`).join(", "));
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
