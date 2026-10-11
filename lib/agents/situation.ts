import type { Balance, Quote, Transfer, TransferStatus } from "../airwallex/types";

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
}
