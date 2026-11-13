export interface DeskAction {
  kind: string;
  detail: string;
  requestId?: string;
  /** Present only when the stored action is an FX conversion. */
  quoteId?: string;
  quoteValidTo?: string;
  quoteValidFrom?: string;
  buyAmount?: string;
  buyCurrency?: string;
  sellCurrency?: string;
  /** From the mock quote object when this process still holds it. Absent means the rate is not on the desk. */
  clientRate?: string;
  sellAmount?: string;
  beneficiaryId?: string;
}

export interface DeskFinding {
  check: string;
  severity: "block" | "note";
  detail: string;
  /** Demo clock on the objection, when the ledger stored one. */
  at?: string;
}

export interface DeskRound {
  round: number;
  summary: string;
  decision: string;
  approvedBy?: string;
  approvedAt?: string;
  /** sha256 of the action list, when the decision stored one. */
  boundDigest?: string;
  /** sha256 of the cash snapshot the plan was allowed to use. */
  evidenceDigest?: string;
  decidedAt?: string;
  actions: DeskAction[];
  findings: DeskFinding[];
}

export interface DeskMoney {
  currency: string;
  available: string;
  pending?: string;
  reserved?: string;
  total?: string;
}

export interface DeskStation {
  id: string;
  label: string;
  state: "clear" | "hold" | "block" | "empty" | "unknown";
  detail: string;
}

export interface DeskExecution {
  action: string;
  requestId: string;
  result: string;
  providerId: string | null;
  note: string | null;
}

export interface DeskProvenance {
  fixture: string;
  gitSha: string;
  runId: string;
}

export interface DeskWebhook {
  id: string;
  name: string;
  status: string;
  created: string;
  flag: string;
}

/** Plain view of the $40k desk. Safe to render in the browser. */
export interface DeskView {
  phase: "incident" | "review" | "paid" | "failed";
  transferId: string;
  amount: string;
  currency: string;
  status: string;
  reference: string;
  failure: string;
  beneficiary: string;
  /** Account name on the stored payee now. */
  payeeStored: string;
  /** Account name the supplier confirmed after the mismatch. Fictional. */
  payeeConfirmed: string;
  payeeLast4: string;
  payeeSource: string;
  /** Plain read-back of the original and the cash it could hold. */
  readBack: string;
  payeeUpdates: number | null;
  originalRequestId: string;
  balances: DeskMoney[];
  reserve: string;
  queuedLabel: string;
  queuedAmount: string;
  webhooks: DeskWebhook[];
  rounds: DeskRound[];
  requestId: string;
  receipt: string[] | null;
  transfersCreated: number | null;
  conversionsCreated: number | null;
  transferCalls: number | null;
  transfersSettled: number | null;
  conversionCalls: number | null;
  conversionsSettled: number | null;
  ledgerLabel: string;
  modelLabel: string;
  error: string | null;
  warning: string | null;
  canPlan: boolean;
  canApprove: boolean;
  canReplay: boolean;
  replayed: boolean;
  blockCount: number;
  plannerSeated: boolean;
  wringerSeated: boolean;
  keyReason: string;
  /** The desk key gate is closed for this visitor. Nothing from the shared ledger is in this view. */
  locked: boolean;
  lockNote: string | null;
  canUnlock: boolean;
  modeLabel: string;
  focus: string;
  stations: DeskStation[];
  executions: DeskExecution[];
  balancesBefore: DeskMoney[];
  provenance: DeskProvenance;
  publicFixture: boolean;
  downloadHref: string | null;
}
