import type { MemoryLedger } from "./memory";

function defined<T extends Record<string, unknown>>(row: T): T {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)) as T;
}

/** Maps the in-memory ledger onto `ledger:upsertIncident`. Ids stay the app's string ids. */
export function toIncidentArgs(ledger: MemoryLedger, secret: string) {
  const intent = ledger.intents[0];
  if (!intent) throw new Error("ledger has no intent");
  return {
    secret,
    intent: { key: intent.id, title: intent.title, status: intent.status, createdAt: intent.createdAt },
    proposals: ledger.proposals.map((p) => ({
      key: p.id,
      intentKey: p.intentId,
      round: p.round,
      author: p.author,
      summary: p.summary,
      actions: p.actions,
      createdAt: p.createdAt,
    })),
    objections: ledger.objections.map((o) => ({
      key: o.id,
      proposalKey: o.proposalId,
      author: o.author,
      check: o.check,
      severity: o.severity,
      detail: o.detail,
      createdAt: o.createdAt,
    })),
    decisions: ledger.decisions.map((d) => defined({
      key: d.id,
      proposalKey: d.proposalId,
      plannerAgrees: d.plannerAgrees,
      wringerAgrees: d.wringerAgrees,
      needsHuman: d.needsHuman,
      humanApprovedBy: d.humanApprovedBy,
      humanApprovedAt: d.humanApprovedAt,
      expiredAt: d.expiredAt,
      status: d.status,
      createdAt: d.createdAt,
    })),
    executions: ledger.executions.map((e) => defined({
      key: e.id,
      decisionKey: e.decisionId,
      requestId: e.requestId,
      actionKind: e.actionKind,
      result: e.result,
      airwallexId: e.airwallexId,
      response: e.response,
      createdAt: e.createdAt,
    })),
    receipts: ledger.receipts.map((r) => ({
      key: r.id,
      intentKey: r.intentId,
      lines: r.lines,
      createdAt: r.createdAt,
    })),
  };
}

export interface RemoteExecution {
  requestId: string;
  result: string;
  airwallexId?: string;
  actionKind: string;
}

export interface RemoteIncident {
  intent: { key: string; title: string; status: string; createdAt: number } | null;
  proposals: { key: string; round: number; summary: string; actions: { kind: string; requestId?: string; amount?: number; currency?: string; buyAmount?: number; payoutId?: string }[] }[];
  objections: { proposalKey: string; check: string; severity: "block" | "note"; detail: string }[];
  decisions: { proposalKey: string; status: string; humanApprovedBy?: string }[];
  executions: RemoteExecution[];
  receipts: { lines: string[] }[];
}
