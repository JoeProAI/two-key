import type { AirwallexClient } from "../airwallex/types";
import { AirwallexError } from "../airwallex/types";
import type { MemoryLedger } from "../ledger/memory";
import type { Action, Decision, Proposal } from "../ledger/types";
import { toMajorString } from "../money";
import type { Finding } from "./wringer";
import { FX_MIN_HEADROOM_MS } from "./wringer";
import { parseAwxTime } from "../webhooks/inbox";

/** Both keys: planner proposed it, Wringer raised no blocking objection. Then the human gate. */
export function decide(ledger: MemoryLedger, proposal: Proposal, findings: Finding[], thresholdUsd: number, now: number): Decision {
  const blocked = findings.some((f) => f.severity === "block");
  const moneyOut = proposal.actions.reduce((n, a) => n + (a.kind === "retry_transfer" ? a.amount : a.kind === "fx_conversion" ? a.buyAmount : 0), 0);
  const d: Decision = {
    id: ledger.id("dec"), proposalId: proposal.id, plannerAgrees: true, wringerAgrees: !blocked,
    needsHuman: moneyOut >= thresholdUsd, status: blocked ? "blocked" : moneyOut >= thresholdUsd ? "awaiting_human" : "approved", createdAt: now,
  };
  ledger.decisions.push(d);
  return d;
}

export function approve(ledger: MemoryLedger, decisionId: string, who: string, now: number): Decision {
  const d = ledger.decisions.find((x) => x.id === decisionId);
  if (!d) throw new Error("no such decision");
  if (!d.wringerAgrees) throw new Error("Wringer blocked this decision; a human tap cannot override it here.");
  d.humanApprovedBy = who;
  d.humanApprovedAt = now;
  d.status = "approved";
  return d;
}

/** Runs only approved decisions. Each action is claimed by request_id in the ledger first;
 *  a second run of the same decision (or a replayed webhook) returns already_done and makes no API call. */
export async function execute(ledger: MemoryLedger, awx: AirwallexClient, decision: Decision, proposal: Proposal, now: number, deferredPayouts: Set<string>) {
  if (decision.status !== "approved" || !decision.plannerAgrees || !decision.wringerAgrees) {
    throw new Error(`Decision ${decision.id} is ${decision.status}; executor refuses.`);
  }
  if (decision.needsHuman && !decision.humanApprovedBy) throw new Error("Needs human approval.");
  const order: Action["kind"][] = ["defer_payout", "fx_conversion", "retry_transfer"]; // fund before paying
  const actions = [...proposal.actions].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const out = [];
  for (const a of actions) {
    const requestId = a.kind === "defer_payout" ? `defer:${a.payoutId}` : a.requestId;
    const prior = ledger.executionByRequestId(requestId);
    if (prior) {
      out.push({ ...prior, result: "already_done" as const });
      continue;
    }
    let response: unknown;
    let airwallexId: string | undefined;
    let result: "ok" | "already_done" | "error" = "ok";
    try {
      if (a.kind === "defer_payout") {
        deferredPayouts.add(a.payoutId);
        response = { deferred: a.payoutId, until: a.until };
      } else if (a.kind === "fx_conversion") {
        if (parseAwxTime(a.quoteValidToAt) - now < FX_MIN_HEADROOM_MS) throw new Error("quote went stale before execution");
        const c = await awx.createConversion({ request_id: a.requestId, buy_currency: a.buyCurrency, sell_currency: a.sellCurrency, buy_amount: toMajorString(a.buyAmount, a.buyCurrency), quote_id: a.quoteId });
        response = c;
        airwallexId = c.conversion_id;
      } else {
        // Re-read the original right before paying (webhooks may be stale).
        const orig = await awx.getTransfer(a.originalTransferId);
        if (orig.status !== "CANCELLED" && orig.status !== "FAILED") throw new Error(`original is ${orig.status}, refusing to retry`);
        const existing = await awx.findTransferByRequestId(a.requestId);
        if (existing) {
          result = "already_done";
          response = existing;
          airwallexId = existing.id;
        } else {
          const t = await awx.createTransfer({
            request_id: a.requestId, beneficiary_id: a.beneficiaryId, transfer_amount: toMajorString(a.amount, a.currency),
            transfer_currency: a.currency, source_currency: a.currency, transfer_method: "LOCAL", reference: a.reference, reason: "supplier_payment",
          });
          response = t;
          airwallexId = t.id;
        }
      }
    } catch (e) {
      result = "error";
      response = { message: (e as Error).message, status: e instanceof AirwallexError ? e.status : undefined };
    }
    const ex = { id: ledger.id("exe"), decisionId: decision.id, requestId, actionKind: a.kind, result, airwallexId, response, createdAt: now };
    ledger.executions.push(ex);
    out.push(ex);
    if (result === "error") break; // never pay after a failed funding step
  }
  return out;
}
