import type { AirwallexClient } from "../airwallex/types";
import { AirwallexError } from "../airwallex/types";
import type { MemoryLedger } from "../ledger/memory";
import type { Action, Decision, Execution, Proposal } from "../ledger/types";
import { toMajorString } from "../money";
import type { Finding } from "./wringer";
import { FX_MIN_HEADROOM_MS } from "./wringer";
import { parseAwxTime } from "../webhooks/inbox";
import { randomUUID } from "node:crypto";
import { finishRequest, takeRequestSlot } from "../ledger/remote";
import { planDigest } from "../receipt/bind";
import { conversionAgrees, expectedRequestId, priorAgrees, transferAgrees } from "./reconcile";

/** Both keys: planner proposed it, Wringer raised no blocking objection. Then the human gate. */
export function decide(ledger: MemoryLedger, proposal: Proposal, findings: Finding[], thresholdUsd: number, now: number): Decision {
  const blocked = findings.some((f) => f.severity === "block");
  const moneyOut = proposal.actions.reduce((n, a) => n + (a.kind === "retry_transfer" ? a.amount : a.kind === "fx_conversion" ? a.buyAmount : 0), 0);
  const d: Decision = {
    id: ledger.id("dec"), proposalId: proposal.id, plannerAgrees: true, wringerAgrees: !blocked,
    needsHuman: moneyOut >= thresholdUsd, status: blocked ? "blocked" : moneyOut >= thresholdUsd ? "awaiting_human" : "approved", createdAt: now,
    boundDigest: planDigest(proposal.actions),
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

export function approve(ledger: MemoryLedger, decisionId: string, who: string, now: number, timeoutMs = Infinity, evidenceNow?: string): Decision {
  const d = ledger.decisions.find((x) => x.id === decisionId);
  if (!d) throw new Error("no such decision");
  expireIfStale(ledger, decisionId, now, timeoutMs);
  if (d.status === "expired") throw new Error("Approval window closed; this decision expired and must be re-planned.");
  if (!d.wringerAgrees) throw new Error("Wringer blocked this decision; a human tap cannot override it here.");
  if (d.evidenceDigest && evidenceNow && evidenceNow !== d.evidenceDigest) {
    throw new Error("Evidence changed since this plan was filed. The tap is refused. Re-plan.");
  }
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
  if (decision.boundDigest && decision.boundDigest !== planDigest(proposal.actions)) {
    throw new Error("The approved plan no longer matches the bound actions. Re-plan.");
  }
  const order: Action["kind"][] = ["defer_payout", "fx_conversion", "retry_transfer"]; // fund before paying
  const actions = [...proposal.actions].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const owner = randomUUID();
  const out: Execution[] = [];
  for (const a of actions) {
    const requestId = a.kind === "defer_payout" ? `defer:${a.payoutId}` : a.requestId;
    if (a.kind !== "defer_payout" && a.requestId !== expectedRequestId(proposal.intentId, a)) {
      const mismatch = { id: ledger.id("exe"), decisionId: decision.id, requestId, actionKind: a.kind, result: "error" as const, response: { message: "This request_id does not match the action payload. No new send." }, createdAt: now };
      ledger.executions.push(mismatch);
      out.push(mismatch);
      break;
    }
    const prior = ledger.executionByRequestId(requestId);
    if (prior) {
      if (!priorAgrees(a, prior.response)) {
        const clash = { id: ledger.id("exe"), decisionId: decision.id, requestId, actionKind: a.kind, result: "error" as const, response: { message: "This request_id already completed a different payload. That receipt is not this action. No new send." }, createdAt: now };
        ledger.executions.push(clash);
        out.push(clash);
        break;
      }
      prior.replays = (prior.replays ?? 0) + 1;
      prior.lastReplayAt = now;
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
          if (!conversionAgrees(a, existing)) throw new Error("This request_id already completed a different payload. That receipt is not this action. No new send.");
          result = "already_done";
          response = existing;
          airwallexId = existing.conversion_id;
        } else if (existing) {
          throw new Error(`conversion ${existing.conversion_id} for this request_id was CANCELLED; a human must decide`);
        } else {
          const retry = proposal.actions.find((x) => x.kind === "retry_transfer");
          if (retry && retry.kind === "retry_transfer") {
            const live = await awx.findTransferByRequestId(retry.requestId);
            if (live && live.status !== "FAILED" && live.status !== "CANCELLED") {
              throw new Error("The retry transfer for this intent is already on the provider. A new conversion was not sent.");
            }
          }
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
          if (!transferAgrees(a, existing)) throw new Error("This request_id already completed a different payload. That receipt is not this action. No new send.");
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
      if (!busy) {
        const recorded = await finishRequest({ ...ex, owner });
        if (recorded === "rejected") {
          // The shared row belongs to someone else. Dropping our provider id here does not undo a call that already left.
          ex.result = "error";
          ex.airwallexId = undefined;
          ex.response = {
            message: "The shared ledger kept another worker's outcome for this request_id. If this worker already called the provider, that call was not undone and its result is unknown here.",
            providerCall: "issued_outcome_unknown",
          };
        }
      }
    } catch {
      /* The local row and the Airwallex lookup still block a second send. */
    }
    out.push(ex);
    if (ex.result === "error") break; // never pay after a failed funding step
  }
  return out;
}
