import type { Balance, Transfer, WebhookEvent } from "./types";

// Hand-written fixtures for the demo scenario. Shapes follow the Airwallex docs; values are invented.
export const T0 = Date.parse("2026-11-02T14:00:00Z");
export const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "+0000");

export const SUPPLIER_BENEFICIARY_ID = "9a45987e-cffc-4f0a-81d7-000000000001";
export const ORIGINAL_TRANSFER_ID = "43217eec-6053-4fe6-b760-000000000040";
export const ORIGINAL_REQUEST_ID = "legacy-erp-req-40000";

export const originalTransfer: Transfer = {
  id: ORIGINAL_TRANSFER_ID,
  request_id: ORIGINAL_REQUEST_ID,
  status: "CANCELLED", // FAILED transfers "will be automatically cancelled in seconds"
  transfer_amount: 40000,
  transfer_currency: "USD",
  source_currency: "USD",
  beneficiary_id: SUPPLIER_BENEFICIARY_ID,
  reference: "INV-2291 Northwind Steel",
  failure_reason: { code: "INVALID_ACCOUNT_NAME_OR_NUMBER", description: "Beneficiary account name mismatch" },
  created_at: iso(T0 - 3_600_000),
};

export const balances: Balance[] = [
  { currency: "USD", available_amount: 22000, pending_amount: 0, reserved_amount: 0, total_amount: 22000 },
  { currency: "EUR", available_amount: 60000, pending_amount: 0, reserved_amount: 0, total_amount: 60000 },
];

/** Mock FX: buy USD with EUR. client_rate expressed as USD per EUR. */
export const EURUSD = 1.08;

const tx = (status: Transfer["status"]): Transfer => ({ ...originalTransfer, status });

/** Delivery order as the receiver sees it: duplicates and out-of-order on purpose. */
export const demoWebhookDeliveries: WebhookEvent<Transfer>[] = [
  { id: "evt_failed_01", name: "payout.transfer.failed", account_id: "acct_demo", data: { object: tx("FAILED") }, created_at: iso(T0 - 600_000), version: "2025-06-30" },
  // Same event delivered twice (same id). Must count once.
  { id: "evt_failed_01", name: "payout.transfer.failed", account_id: "acct_demo", data: { object: tx("FAILED") }, created_at: iso(T0 - 600_000), version: "2025-06-30" },
  { id: "evt_cancel_02", name: "payout.transfer.cancelled", account_id: "acct_demo", data: { object: tx("CANCELLED") }, created_at: iso(T0 - 590_000), version: "2025-06-30" },
  // Arrives last but was created first. Arrival order would say PROCESSING; created_at order says CANCELLED.
  { id: "evt_proc_00", name: "payout.transfer.processing", account_id: "acct_demo", data: { object: tx("PROCESSING") }, created_at: iso(T0 - 1_200_000), version: "2025-06-30" },
];

/** Lower-priority payout queued inside Two-Key (not yet created on Airwallex), so deferring it is a ledger change only. */
export const queuedPayout = { id: "queued_marketing_7000", amount: 7000, currency: "USD", label: "Agency retainer, due in 9 days", priority: "low" as const };

export const RESERVE_USD = 10000;

// Scenario (b): a $25k supplier payout, plenty of USD, so the only gate is the human tap.
export const LARGE_TRANSFER_ID = "43217eec-6053-4fe6-b760-000000000025";
export const largeTransfer: Transfer = {
  ...originalTransfer,
  id: LARGE_TRANSFER_ID,
  request_id: "legacy-erp-req-25000",
  transfer_amount: 25000,
  reference: "INV-3307 Halvorsen Freight",
  created_at: iso(T0 - 1_800_000),
};
export const largeBalances: Balance[] = [
  { currency: "USD", available_amount: 80000, pending_amount: 0, reserved_amount: 0, total_amount: 80000 },
  { currency: "EUR", available_amount: 10000, pending_amount: 0, reserved_amount: 0, total_amount: 10000 },
];
const ltx = (status: Transfer["status"]): Transfer => ({ ...largeTransfer, status });
export const largeWebhookDeliveries: WebhookEvent<Transfer>[] = [
  { id: "evt_l_failed", name: "payout.transfer.failed", account_id: "acct_demo", data: { object: ltx("FAILED") }, created_at: iso(T0 - 300_000), version: "2025-06-30" },
  { id: "evt_l_cancel", name: "payout.transfer.cancelled", account_id: "acct_demo", data: { object: ltx("CANCELLED") }, created_at: iso(T0 - 295_000), version: "2025-06-30" },
];

/** Scenario (a): clean failure, USD short, so the plan needs an FX conversion. */
export const cleanWebhookDeliveries: WebhookEvent<Transfer>[] = [
  { id: "evt_s_failed", name: "payout.transfer.failed", account_id: "acct_demo", data: { object: tx("FAILED") }, created_at: iso(T0 - 600_000), version: "2025-06-30" },
  { id: "evt_s_cancel", name: "payout.transfer.cancelled", account_id: "acct_demo", data: { object: tx("CANCELLED") }, created_at: iso(T0 - 590_000), version: "2025-06-30" },
];

/** How long a decision may wait for a human tap before it expires (scenario b). */
export const APPROVAL_TIMEOUT_MS = 4 * 3_600_000;
