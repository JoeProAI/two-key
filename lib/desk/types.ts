export interface DeskAction {
  kind: string;
  detail: string;
  requestId?: string;
}

export interface DeskFinding {
  check: string;
  severity: "block" | "note";
  detail: string;
}

export interface DeskRound {
  round: number;
  summary: string;
  decision: string;
  approvedBy?: string;
  actions: DeskAction[];
  findings: DeskFinding[];
}

export interface DeskMoney {
  currency: string;
  available: string;
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
