import type { AirwallexClient } from "../airwallex/types";
import { AirwallexError } from "../airwallex/types";
import type { MemoryLedger } from "../ledger/memory";
import type { Action, Decision, Proposal } from "../ledger/types";
import { toMajorString } from "../money";
import type { Finding } from "./wringer";
import { FX_MIN_HEADROOM_MS } from "./wringer";
import { parseAwxTime } from "../webhooks/inbox";
import { randomUUID } from "node:crypto";
import { finishRequest, takeRequestSlot } from "../ledger/remote";

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

/** A decision waiting on a human expires after timeoutMs. Expired decisions never run; the planner must start over
 *  with fresh balances and a fresh quote. Returns true if this call expired it. */
export function expireIfStale(ledger: MemoryLedger, decisionId: string, now: number, timeoutMs: number): boolean {
  const d = ledger.decisions.find((x) => x.id === decisionId);
  if (!d || d.status !== "awaiting_human" || now - d.createdAt < timeoutMs) return false;
  d.status = "expired";
  d.expiredAt = now;
  return true;
}

export function approve(ledger: MemoryLedger, decisionId: string, who: string, now: number, timeoutMs = Infinity): Decision {
  const d = ledger.decisions.find((x) => x.id === decisionId);
  if (!d) throw new Error("no such decision");
  expireIfStale(ledger, decisionId, now, timeoutMs);
  if (d.status === "expired") throw new Error("Approval window closed; this decision expired and must be re-planned.");
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
  const owner = randomUUID();
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
    let busy = false;
    try {
      const slot = await takeRequestSlot({ decisionId: decision.id, requestId, actionKind: a.kind, owner });
      if (slot === "busy") {
        busy = true;
        throw new Error("Another worker holds the claim on this request_id. Wait for it to finish or for its lease to expire.");
      }
      if (slot === "taken") {
        result = "already_done";
        response = { ledger: "request_id already claimed" };
      } else if (a.kind === "defer_payout") {
        deferredPayouts.add(a.payoutId);
        response = { deferred: a.payoutId, until: a.until };
      } else if (a.kind === "fx_conversion") {
        // Look the request_id up first (GET /api/v1/fx/conversions?request_id=), like transfers do.
        // A ledger lost between runs must never turn into a second conversion.
        const existing = await awx.findConversionByRequestId(a.requestId);
        if (existing && existing.status !== "CANCELLED") {
          result = "already_done";
          response = existing;
          airwallexId = existing.conversion_id;
        } else if (existing) {
          throw new Error(`conversion ${existing.conversion_id} for this request_id was CANCELLED; a human must decide`);
        } else {
          if (parseAwxTime(a.quoteValidToAt) - now < FX_MIN_HEADROOM_MS) throw new Error("quote went stale before execution");
          const c = await awx.createConversion({ request_id: a.requestId, buy_currency: a.buyCurrency, sell_currency: a.sellCurrency, buy_amount: toMajorString(a.buyAmount, a.buyCurrency), quote_id: a.quoteId });
          response = c;
          airwallexId = c.conversion_id;
        }
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
            transfer_currency: a.currency, source_currency: a.currency, transfer_method: "LOCAL", reference: a.reference,
            // https://www.airwallex.com/docs/payouts/transfers/create-a-transfer — accepted values do not include
            // `supplier_payment`. `bill_payment` is the supplier-invoice purpose.
            reason: "bill_payment",
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
    try {
      if (!busy) await finishRequest({ ...ex, owner });
    } catch {
      /* The local row and the Airwallex lookup still block a second send. */
    }
    out.push(ex);
    if (result === "error") break; // never pay after a failed funding step
  }
  return out;
}
