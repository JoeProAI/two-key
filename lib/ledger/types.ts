// Mirrors convex/schema.ts. The in-memory ledger is used in mock mode and tests;
// the Convex functions in convex/ledger.ts write the same records in the app.
export type Action =
  | { kind: "retry_transfer"; originalTransferId: string; amount: number; currency: string; beneficiaryId: string; reference: string; requestId: string }
  | { kind: "fx_conversion"; buyCurrency: string; sellCurrency: string; buyAmount: number; quoteId: string; quoteValidToAt: string; requestId: string }
  | { kind: "defer_payout"; payoutId: string; amount: number; currency: string; until: string };

export interface Intent { id: string; title: string; createdAt: number; status: "open" | "resolved" | "blocked" }
export interface Proposal { id: string; intentId: string; round: number; author: "planner"; summary: string; actions: Action[]; createdAt: number }
export interface Objection { id: string; proposalId: string; author: "wringer"; check: string; severity: "block" | "note"; detail: string; createdAt: number }
export interface Decision {
  id: string; proposalId: string; plannerAgrees: boolean; wringerAgrees: boolean; needsHuman: boolean;
  humanApprovedBy?: string; humanApprovedAt?: number; expiredAt?: number;
  /** sha256 of the action list. Execution refuses a plan that no longer matches. */
  boundDigest?: string;
  /** sha256 of the balances, webhook status, quote, reserve, and queue the plan used. A tap with a different snapshot is refused. */
  evidenceDigest?: string;
  status: "blocked" | "awaiting_human" | "approved" | "expired"; createdAt: number;
}
export interface Execution {
  id: string; decisionId: string; requestId: string; actionKind: Action["kind"]; result: "ok" | "already_done" | "error";
  airwallexId?: string; response: unknown; createdAt: number;
  replays?: number; lastReplayAt?: number;
}
export interface Receipt { id: string; intentId: string; lines: string[]; createdAt: number }
