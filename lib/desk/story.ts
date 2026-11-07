import type { DeskStation, DeskView } from "./types";

/** Plain words for the desk. Derived from the view. No new payment rules. */

export function poster(view: DeskView): { word: string; tone: "fail" | "ok" | "wait" | "lock"; line: string } {
  if (view.locked) return { word: "Locked", tone: "lock", line: view.lockNote ?? "The ledger stays closed." };
  if (view.replayed) return { word: "Same payment", tone: "ok", line: "No new send. The provider ids match the recorded payment." };
  if (view.phase === "failed") {
    return { word: "Not paid", tone: "fail", line: view.error ?? "The approved plan did not finish. Nothing is marked paid." };
  }
  if (view.phase === "paid") return { word: "Paid once", tone: "ok", line: "One supplier payment was sent." };
  if (view.blockCount > 0) {
    const noun = view.blockCount === 1 ? "objection is" : "objections are";
    return { word: "Blocked", tone: "fail", line: `${view.blockCount} ${noun} stopping a tap. Nothing has been sent.` };
  }
  const latest = view.rounds.at(-1);
  if (latest?.decision === "awaiting_human") {
    return { word: "Waiting", tone: "wait", line: "The latest plan is clear. Nothing has been sent." };
  }
  if (!view.plannerSeated) {
    return { word: "Not planned", tone: "wait", line: `${view.amount} ${view.currency} cancelled. ${view.failure}` };
  }
  return { word: "In review", tone: "wait", line: "The plan is on the desk. Nothing has been sent." };
}

export function decisionCopy(view: DeskView): { accent: string; rest: string } {
  if (view.locked) {
    return { accent: "Desk locked.", rest: view.lockNote ?? "The ledger stays closed." };
  }
  if (view.replayed) {
    return { accent: "Same payment.", rest: "No new send. The provider ids match the recorded payment." };
  }
  if (view.phase === "failed") {
    const detail = view.error ?? "The approved plan did not finish. Nothing is marked paid.";
    return { accent: "Not paid.", rest: `${detail} Balances are unchanged.` };
  }
  if (view.phase === "paid") {
    return { accent: "Paid once.", rest: "One supplier payment was sent. The balances below are the result." };
  }
  if (view.blockCount > 0) {
    const noun = view.blockCount === 1 ? "objection is" : "objections are";
    return { accent: "Blocked.", rest: `${view.blockCount} ${noun} stopping a tap. Nothing has been sent.` };
  }
  const latest = view.rounds.at(-1);
  if (latest?.decision === "awaiting_human") {
    return { accent: "Waiting for a tap.", rest: "The latest plan is clear. Nothing has been sent." };
  }
  if (!view.plannerSeated) {
    return {
      accent: "Not planned.",
      rest: `The ${view.amount} ${view.currency} transfer is ${view.status.toLowerCase()}. ${view.failure}`,
    };
  }
  return { accent: "In review.", rest: "The plan is on the desk. Nothing has been sent." };
}

export function gateLine(view: DeskView): string {
  if (view.locked) return view.keyReason;
  if (view.phase === "paid" || view.phase === "failed") return view.keyReason;
  if (!view.plannerSeated) return "No plan is filed. Run the planner.";
  if (!view.wringerSeated) {
    const noun = view.blockCount === 1 ? "objection is" : "objections are";
    return `${view.blockCount} ${noun} blocking a tap.`;
  }
  return "The plan is clear. One tap pays once.";
}

export function proposalLine(view: DeskView): string {
  const latest = view.rounds.at(-1);
  if (!latest) return "No plan filed.";
  return `Round ${latest.round}. ${latest.summary}`;
}

const DECISION_WORDS: Record<string, string> = {
  awaiting_human: "Waiting for a tap",
  approved: "Approved",
  blocked: "Blocked",
  expired: "Expired",
  open: "Open",
};

export function approvalLine(view: DeskView): string {
  const latest = view.rounds.at(-1);
  if (!latest) return "No decision yet.";
  const word = DECISION_WORDS[latest.decision] ?? latest.decision;
  return latest.approvedBy ? `${word} by ${latest.approvedBy}.` : `${word}.`;
}

export function resultLine(view: DeskView): string {
  if (view.replayed) return "Replayed. No new send.";
  if (view.phase === "paid") return "Paid once.";
  if (view.phase === "failed") return "Not marked paid.";
  if (view.executions.some((row) => row.result === "error")) return "A send failed.";
  return "Not sent.";
}

export function countLine(view: DeskView): string | null {
  if (view.transferCalls !== null) {
    return `Transfer calls ${view.transferCalls}, settled ${view.transfersSettled ?? 0}. Conversion calls ${view.conversionCalls}, settled ${view.conversionsSettled ?? 0}.`;
  }
  if (view.transfersSettled !== null) {
    return `Transfers settled ${view.transfersSettled}. Conversions settled ${view.conversionsSettled ?? 0}. Call attempts are not stored on this ledger.`;
  }
  return null;
}

export function stationNote(station: DeskStation): string {
  const words: Record<string, string> = {
    awaiting_human: "Waiting for a tap",
    approved: "Approved",
    blocked: "Blocked",
    expired: "Expired",
    open: "Open",
    already_done: "Same ids",
    "No block": "No objection",
    Recorded: "Sent",
    "No plan filed": "No plan",
  };
  return words[station.detail] ?? station.detail;
}

export function tabLabel(id: string, fallback: string): string {
  if (id === "request") return "Transfer";
  if (id === "wringer") return "Objections";
  if (id === "execution") return "Sends";
  return fallback;
}

export function actionName(kind: string): string {
  if (kind === "fx_conversion") return "Conversion";
  if (kind === "retry_transfer") return "Retry transfer";
  if (kind === "defer_payout") return "Defer payout";
  return kind;
}

export function resultWord(result: string): string {
  if (result === "ok") return "Sent";
  if (result === "error") return "Failed";
  if (result === "already_done") return "Already sent";
  return result;
}
