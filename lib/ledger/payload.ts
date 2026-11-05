import { MemoryLedger } from "./memory";
import type { Action, Decision, Execution, Intent } from "./types";

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
  key?: string;
  decisionKey?: string;
  requestId: string;
  result: string;
  airwallexId?: string;
  actionKind: string;
  response?: unknown;
  createdAt?: number;
}

export interface RemoteIncident {
  intent: { key: string; title: string; status: string; createdAt: number } | null;
  proposals: { key: string; intentKey?: string; round: number; summary: string; actions: { kind: string; requestId?: string; amount?: number; currency?: string; buyAmount?: number; payoutId?: string }[]; createdAt?: number }[];
  objections: { key?: string; proposalKey: string; check: string; severity: "block" | "note"; detail: string; createdAt?: number }[];
  decisions: {
    key?: string; proposalKey: string; status: string; humanApprovedBy?: string; humanApprovedAt?: number; expiredAt?: number;
    plannerAgrees?: boolean; wringerAgrees?: boolean; needsHuman?: boolean; createdAt?: number;
  }[];
  executions: RemoteExecution[];
  receipts: { key?: string; intentKey?: string; lines: string[]; createdAt?: number }[];
}

const SETTLED = new Set(["ok", "already_done", "error"]);

/** Rebuilds a MemoryLedger from `ledger:getIncident` so a restarted process can act on a pending decision.
 *  Returns null when a row is missing the keys the ledger needs. `claimed` rows stay in Convex. */
export function ledgerFromRemote(remote: RemoteIncident): MemoryLedger | null {
  const intent = remote.intent;
  if (!intent) return null;
  const keyed = [...remote.objections, ...remote.decisions, ...remote.receipts].every((r) => r.key);
  if (!keyed) return null;
  const ledger = new MemoryLedger();
  const at = (t: number | undefined) => t ?? intent.createdAt;
  ledger.intents.push({ id: intent.key, title: intent.title, status: intent.status as Intent["status"], createdAt: intent.createdAt });
  for (const p of remote.proposals) {
    ledger.proposals.push({ id: p.key, intentId: p.intentKey ?? intent.key, round: p.round, author: "planner", summary: p.summary, actions: p.actions as Action[], createdAt: at(p.createdAt) });
  }
  for (const o of remote.objections) {
    ledger.objections.push({ id: o.key!, proposalId: o.proposalKey, author: "wringer", check: o.check, severity: o.severity, detail: o.detail, createdAt: at(o.createdAt) });
  }
  for (const d of remote.decisions) {
    ledger.decisions.push({
      id: d.key!, proposalId: d.proposalKey, plannerAgrees: d.plannerAgrees ?? false, wringerAgrees: d.wringerAgrees ?? false, needsHuman: d.needsHuman ?? true,
      humanApprovedBy: d.humanApprovedBy, humanApprovedAt: d.humanApprovedAt, expiredAt: d.expiredAt, status: d.status as Decision["status"], createdAt: at(d.createdAt),
    });
  }
  for (const e of remote.executions) {
    if (!e.key || !e.decisionKey || !SETTLED.has(e.result)) continue;
    ledger.executions.push({
      id: e.key, decisionId: e.decisionKey, requestId: e.requestId, actionKind: e.actionKind as Action["kind"], result: e.result as Execution["result"],
      airwallexId: e.airwallexId, response: e.response ?? null, createdAt: at(e.createdAt),
    });
  }
  for (const r of remote.receipts) ledger.receipts.push({ id: r.key!, intentId: r.intentKey ?? intent.key, lines: r.lines, createdAt: at(r.createdAt) });
  ledger.reserveIds([...ledger.proposals, ...ledger.objections, ...ledger.decisions, ...ledger.executions, ...ledger.receipts].map((r) => r.id));
  return ledger;
}
