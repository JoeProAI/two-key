import type { Balance, BeneficiaryView, Quote, Transfer, TransferStatus } from "../airwallex/types";

export interface SupplierCorrection { beneficiaryId: string; companyName: string; accountName: string; accountLast4: string; source: string; receivedAt: string }

/** Read-back of the original before any retry: its status and the cash it could still be holding. */
export interface ReadBack { transferId: string; status: TransferStatus; failureCode: string; currency: string; available: number; pending: number; reserved: number }

/** The original failed because the bank rejected the payee name or account. */
export function payeeMismatch(t: Transfer): boolean {
  const f = t.failure_reason;
  const text = typeof f === "string" ? f : `${f?.code ?? ""} ${f?.description ?? ""}`;
  return /NAME|ACCOUNT|MISMATCH/i.test(text);
}

export function failureCode(t: Transfer): string {
  const f = t.failure_reason;
  return typeof f === "string" ? f : f?.code ?? "";
}

/** Everything the agents see. Built by code from Airwallex reads + the webhook inbox. */
export interface Situation {
  intentId: string;
  now: number;
  original: Transfer; // fresh from GET /api/v1/transfers/{id}
  webhook: {
    statusByCreatedAt: TransferStatus | null;
    statusByArrival: TransferStatus | null;
    sawFailedEvent: boolean;
    failedDeliveries: number; // raw deliveries including duplicates
    uniqueFailedEvents: number;
    duplicates: { id: string; deliveries: number }[];
  };
  balances: Balance[];
  reserve: { currency: string; amount: number };
  queuedPayouts: { id: string; amount: number; currency: string; label: string; priority: "low" | "normal" }[];
  quote?: Quote; // EUR->USD quote, if the planner asked for one
  approvalThresholdUsd: number;
  beneficiary?: BeneficiaryView; // fresh from GET /api/v1/beneficiaries/{id}
  correction?: SupplierCorrection; // new information from the supplier, if any
  readBack?: ReadBack;
}
