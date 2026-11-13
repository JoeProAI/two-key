import type { AirwallexClient, Conversion, Transfer } from "../airwallex/types";
import type { MemoryLedger } from "../ledger/memory";
import type { Action, Execution } from "../ledger/types";
import { finishRequest } from "../ledger/remote";
import { correctionRequestId, fxRequestId, retryRequestId } from "../requestId";
import { randomUUID } from "node:crypto";

/** The request_id this action is allowed to carry. A changed amount, currency, or beneficiary is a different id. */
export function expectedRequestId(intentId: string, action: Action): string {
  if (action.kind === "defer_payout") return `defer:${action.payoutId}`;
  if (action.kind === "correct_beneficiary") return correctionRequestId(intentId, action.beneficiaryId, action.companyName, action.accountName);
  if (action.kind === "fx_conversion") return fxRequestId(intentId, action.buyAmount, action.buyCurrency, action.sellCurrency);
  return retryRequestId(intentId, "0", {
    originalTransferId: action.originalTransferId,
    amount: action.amount,
    currency: action.currency,
    beneficiaryId: action.beneficiaryId,
  });
}

export function conversionAgrees(action: Extract<Action, { kind: "fx_conversion" }>, existing: Conversion): boolean {
  return existing.buy_amount === action.buyAmount && existing.buy_currency === action.buyCurrency && existing.sell_currency === action.sellCurrency;
}

export function transferAgrees(action: Extract<Action, { kind: "retry_transfer" }>, existing: Transfer): boolean {
  return existing.transfer_amount === action.amount && existing.transfer_currency === action.currency && (existing.beneficiary_id ?? "") === action.beneficiaryId;
}

/** A stored response only counts as this action when its money fields match. A missing body is not a contradiction. */
export function priorAgrees(action: Action, response: unknown): boolean {
  if (!response || typeof response !== "object") return true;
  if (action.kind === "fx_conversion" && "buy_amount" in response) return conversionAgrees(action, response as Conversion);
  if (action.kind === "retry_transfer" && "transfer_amount" in response) return transferAgrees(action, response as Transfer);
  if (action.kind === "correct_beneficiary" && "companyName" in response) {
    const b = response as { companyName: string; accountName: string };
    return b.companyName === action.companyName && b.accountName === action.accountName;
  }
  return true;
}

/** Read the provider for the original actions. Never creates a quote, conversion, or transfer. */
export async function reconcileSettled(
  awx: AirwallexClient,
  intentId: string,
  actions: Action[],
  ledger: MemoryLedger,
  decisionId: string,
  now: number,
): Promise<Execution[]> {
  const order: Action["kind"][] = ["defer_payout", "correct_beneficiary", "fx_conversion", "retry_transfer"];
  const sorted = [...actions].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const owner = randomUUID();
  const out: Execution[] = [];
  for (const action of sorted) {
    const requestId = action.kind === "defer_payout" ? `defer:${action.payoutId}` : action.requestId;
    let result: Execution["result"] = "already_done";
    let airwallexId: string | undefined;
    let response: unknown;
    if (requestId !== expectedRequestId(intentId, action)) {
      result = "error";
      response = { message: "request_id does not match this action payload. Reconcile did not send." };
    } else if (action.kind === "defer_payout") {
      response = { deferred: action.payoutId, until: action.until };
    } else if (action.kind === "correct_beneficiary") {
      const b = await awx.getBeneficiary(action.beneficiaryId);
      response = b;
      airwallexId = b.id;
      if (b.companyName !== action.companyName || b.accountName !== action.accountName) {
        result = "error";
        response = { message: "The payee on Airwallex does not carry the corrected names. Reconcile did not send." };
      }
    } else if (action.kind === "fx_conversion") {
      const existing = await awx.findConversionByRequestId(requestId);
      if (!existing) {
        result = "error";
        response = { message: "No conversion is on the provider for this request_id. Reconcile did not create one." };
      } else if (!conversionAgrees(action, existing)) {
        result = "error";
        response = { message: "This request_id is bound to a different conversion. That execution is not this action. No new conversion was sent." };
      } else {
        airwallexId = existing.conversion_id;
        response = existing;
      }
    } else {
      const existing = await awx.findTransferByRequestId(requestId);
      if (!existing) {
        result = "error";
        response = { message: "No transfer is on the provider for this request_id. Reconcile did not create one." };
      } else if (!transferAgrees(action, existing)) {
        result = "error";
        response = { message: "This request_id is bound to a different transfer. That execution is not this action. No new transfer was sent." };
      } else {
        airwallexId = existing.id;
        response = existing;
      }
    }
    const ex: Execution = { id: ledger.id("exe"), decisionId, requestId, actionKind: action.kind, result, airwallexId, response, createdAt: now };
    ledger.executions.push(ex);
    if (result === "already_done") {
      const prior = ledger.executions.find((e) => e.id !== ex.id && e.requestId === requestId && (e.result === "ok" || e.result === "already_done"));
      if (prior) {
        prior.replays = (prior.replays ?? 0) + 1;
        prior.lastReplayAt = now;
      }
      await finishRequest({ ...ex, owner }).catch(() => undefined);
    }
    out.push(ex);
    if (result === "error") break;
  }
  return out;
}
