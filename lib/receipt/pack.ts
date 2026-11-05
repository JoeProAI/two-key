import type { MemoryLedger } from "../ledger/memory";
import type { Action, Execution } from "../ledger/types";
import { redact } from "./redact";

export type ReceiptMode = "MOCK" | "SANDBOX";

export interface PackExecution {
  action: Execution["actionKind"];
  requestId: string;
  result: Execution["result"];
  providerId: string | null;
  providerCall: "not_sent" | "recorded" | "already_done" | "provider_error" | "issued_outcome_unknown" | "busy";
  note: string | null;
}

export interface ReceiptPack {
  schema: "two-key.receipt.v1";
  mode: ReceiptMode;
  fixture: string;
  gitSha: string;
  runId: string;
  intent: { id: string; title: string };
  evidence: {
    balancesBefore: { currency: string; available: number }[];
    reserve: { currency: string; amount: number };
    queued: { id: string; amount: number; currency: string; label: string }[];
    webhooks: { id: string; name: string; createdAt: string; status: string; deliveries: number }[];
    quote: { id: string; validTo: string; buyAmount: number; sellCurrency: string } | null;
  };
  rounds: {
    round: number;
    summary: string;
    actions: Action[];
    objections: { code: string; severity: "block" | "note"; detail: string }[];
    decision: string;
    approvedBy: string | null;
    boundDigest: string | null;
    evidenceDigest: string | null;
  }[];
  executions: PackExecution[];
  resulting: {
    balancesAfter: { currency: string; available: number }[];
    transfersCreated: number;
    conversionsCreated: number;
  };
  lines: string[];
  note: string;
}

export interface PackInput {
  ledger: MemoryLedger;
  intentId: string;
  mode: ReceiptMode;
  fixture: string;
  gitSha: string;
  runId: string;
  balancesBefore: { currency: string; available: number }[];
  balancesAfter: { currency: string; available: number }[];
  reserve: { currency: string; amount: number };
  queued: { id: string; amount: number; currency: string; label: string }[];
  webhooks: { id: string; name: string; createdAt: string; status: string }[];
  transfersCreated: number;
  conversionsCreated: number;
}

function providerCall(ex: Execution): PackExecution["providerCall"] {
  const body = ex.response as { providerCall?: string; message?: string } | null;
  if (body && body.providerCall === "issued_outcome_unknown") return "issued_outcome_unknown";
  if (ex.result === "already_done") return "already_done";
  if (ex.result === "error") {
    const message = body?.message ?? "";
    if (/holds the claim|busy/i.test(message)) return "busy";
    return "provider_error";
  }
  return "recorded";
}

function noteFor(call: PackExecution["providerCall"], ex: Execution): string | null {
  if (call === "issued_outcome_unknown") {
    return "The shared ledger kept another worker's row. This receipt does not claim the provider call was undone, and it does not claim no money moved.";
  }
  if (call === "busy") return "Another worker holds the claim. This worker did not send.";
  if (call === "already_done") return ex.airwallexId ? `Existing provider id ${ex.airwallexId} kept.` : "Already recorded. No new provider id.";
  if (call === "provider_error") {
    const message = (ex.response as { message?: string } | null)?.message;
    return message ?? "Provider returned an error. This step is not marked paid.";
  }
  return null;
}

/** One inspectable receipt. Redaction runs last so a later field cannot smuggle a secret through. */
export function buildPack(input: PackInput): ReceiptPack {
  const proposals = input.ledger.proposals.filter((p) => p.intentId === input.intentId);
  const intent = input.ledger.intents.find((i) => i.id === input.intentId);
  const seen = new Map<string, number>();
  for (const hook of input.webhooks) seen.set(hook.id, (seen.get(hook.id) ?? 0) + 1);
  const quoteAction = proposals.flatMap((p) => p.actions).find((a) => a.kind === "fx_conversion");
  const executions = input.ledger.executions.map((ex) => {
    const call = providerCall(ex);
    return {
      action: ex.actionKind,
      requestId: ex.requestId,
      result: ex.result,
      providerId: ex.airwallexId ?? null,
      providerCall: call,
      note: noteFor(call, ex),
    };
  });
  const lines = input.ledger.receipts.filter((r) => r.intentId === input.intentId).at(-1)?.lines ?? [];
  const pack: ReceiptPack = {
    schema: "two-key.receipt.v1",
    mode: input.mode,
    fixture: input.fixture,
    gitSha: input.gitSha,
    runId: input.runId,
    intent: { id: input.intentId, title: intent?.title ?? input.intentId },
    evidence: {
      balancesBefore: input.balancesBefore,
      reserve: input.reserve,
      queued: input.queued,
      webhooks: [...seen.entries()].map(([id, deliveries]) => {
        const hook = input.webhooks.find((h) => h.id === id)!;
        return { id, name: hook.name, createdAt: hook.createdAt, status: hook.status, deliveries };
      }),
      quote: quoteAction && quoteAction.kind === "fx_conversion"
        ? { id: quoteAction.quoteId, validTo: quoteAction.quoteValidToAt, buyAmount: quoteAction.buyAmount, sellCurrency: quoteAction.sellCurrency }
        : null,
    },
    rounds: proposals.map((p) => {
      const decision = input.ledger.decisions.find((d) => d.proposalId === p.id);
      return {
        round: p.round,
        summary: p.summary,
        actions: p.actions,
        objections: input.ledger.objections.filter((o) => o.proposalId === p.id).map((o) => ({ code: o.check, severity: o.severity, detail: o.detail })),
        decision: decision?.status ?? "open",
        approvedBy: decision?.humanApprovedBy ?? null,
        boundDigest: decision?.boundDigest ?? null,
        evidenceDigest: decision?.evidenceDigest ?? null,
      };
    }),
    executions,
    resulting: {
      balancesAfter: input.balancesAfter,
      transfersCreated: input.transfersCreated,
      conversionsCreated: input.conversionsCreated,
    },
    lines,
    note: input.mode === "MOCK"
      ? "MOCK FIXTURE. No live money moved. Amounts come from the fixture client."
      : "SANDBOX. Demo money only. Not a production payment.",
  };
  return redact(pack);
}

export function executionsCsv(pack: ReceiptPack): string {
  const header = "action,request_id,result,provider_id,provider_call";
  const rows = pack.executions.map((ex) => [ex.action, ex.requestId, ex.result, ex.providerId ?? "", ex.providerCall].join(","));
  return [header, ...rows].join("\n") + "\n";
}

export function gitSha(env: NodeJS.ProcessEnv = process.env): string {
  return env.TWO_KEY_GIT_SHA || env.VERCEL_GIT_COMMIT_SHA || "unknown";
}
