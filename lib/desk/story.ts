import type { DeskStation, DeskView } from "./types";

/** Plain words for the desk. Derived from the view. No new payment rules. */

export function poster(view: DeskView): { word: string; tone: "fail" | "ok" | "wait" | "lock"; line: string } {
  if (view.locked) return { word: "Locked", tone: "lock", line: view.lockNote ?? "The ledger stays closed." };
  if (view.replayed) return { word: "Result checked", tone: "ok", line: "The recorded ids matched. This check did not create a payment." };
  if (view.phase === "failed") {
    return { word: "Not paid", tone: "fail", line: view.error ?? "The approved plan did not finish. Nothing is marked paid." };
  }
  if (view.phase === "paid") return { word: "Simulated", tone: "ok", line: "A simulated payment is recorded. This is not a live provider payment." };
  if (view.blockCount > 0) {
    const noun = view.blockCount === 1 ? "objection is" : "objections are";
    return { word: "Blocked", tone: "fail", line: `${view.blockCount} ${noun} stopping a tap. Nothing has been sent.` };
  }
  const latest = view.rounds.at(-1);
  if (latest?.decision === "awaiting_human") {
    return { word: "Needs consent", tone: "wait", line: "The checker is clear. Clearance is not consent. Nothing has been sent." };
  }
  if (!view.plannerSeated) {
    return { word: "Not planned", tone: "wait", line: "No cash plan is filed. Nothing has been sent." };
  }
  return { word: "In review", tone: "wait", line: "The plan is on the desk. Nothing has been sent." };
}

export function decisionCopy(view: DeskView): { accent: string; rest: string } {
  if (view.locked) {
    return { accent: "Desk locked.", rest: view.lockNote ?? "The ledger stays closed." };
  }
  if (view.replayed) {
    return { accent: "Result checked.", rest: "The recorded ids matched. This check did not create a payment." };
  }
  if (view.phase === "failed") {
    const detail = view.error ?? "The approved plan did not finish. Nothing is marked paid.";
    return { accent: "Not paid.", rest: `${detail} Balances are unchanged.` };
  }
  if (view.phase === "paid") {
    return { accent: "Simulated payment recorded.", rest: "This is a mock result. It is not a live provider payment." };
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
  if (view.replayed) return "Recorded result checked. No new payment.";
  if (view.phase === "paid") return "Simulated payment recorded.";
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
    Recorded: "Simulated",
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

export function stateLine(view: DeskView): { word: string; tone: "fail" | "ok" | "wait" | "lock"; detail: string } {
  const lead = poster(view);
  return { word: lead.word, tone: lead.tone, detail: lead.line };
}

export function nextCue(view: DeskView): { text: string; href: string } {
  if (view.locked) return { text: "Next: enter the desk key. The planner stays closed.", href: "#authorization" };
  if (view.error && view.phase !== "failed") return { text: "Next: read why the tap was refused. This page does not send.", href: "#authorization" };
  if (view.replayed) return { text: "Next: read the checked ids. There is no further payment step.", href: "#receipt" };
  if (view.phase === "paid" && view.canReplay) return { text: "Next: verify the recorded mock result. That check does not pay again.", href: "#receipt" };
  if (view.phase === "paid") return { text: "A simulated payment is recorded. This page cannot pay again.", href: "#receipt" };
  if (view.phase === "failed") return { text: "Next: read why the simulation stopped. Nothing is marked paid.", href: "#receipt" };
  if (view.blockCount > 0) return { text: "Next: read the checker blocks. A tap cannot override them.", href: "#check" };
  if (view.rounds.at(-1)?.decision === "awaiting_human") return { text: "Next: read every bound term, then the mock approval.", href: "#authorization" };
  if (!view.plannerSeated) return { text: "Next: file a cash plan. Nothing has been sent.", href: "#cash" };
  return { text: "Next: read the plan on the desk.", href: "#cash" };
}

export function rail(view: DeskView): { id: string; label: string; status: string }[] {
  const latest = view.rounds.at(-1);
  const human = view.locked
    ? "Locked"
    : view.error && view.phase !== "failed"
      ? "Tap refused"
    : latest?.decision === "awaiting_human"
      ? "Needs a tap"
      : latest?.decision === "approved"
        ? "Demo label recorded"
        : latest?.decision === "blocked"
          ? "Checker stopped it"
          : latest?.decision === "expired"
            ? "Expired"
            : "No plan";
  return [
    { id: "incident", label: "Incident", status: "History" },
    { id: "cash", label: "Cash plan", status: view.rounds.length ? `Round ${latest?.round ?? view.rounds.length}` : "Not filed" },
    { id: "check", label: "Independent check", status: !view.rounds.length ? "Not run" : view.blockCount ? `${view.blockCount} blocking` : "Clear, not consent" },
    { id: "authorization", label: "Human authorization", status: human },
    { id: "receipt", label: "Receipt", status: view.replayed ? "Checked" : view.phase === "paid" ? "Simulated" : view.phase === "failed" ? "Not marked paid" : "None" },
  ];
}

export function actionName(kind: string): string {
  if (kind === "fx_conversion") return "Conversion";
  if (kind === "retry_transfer") return "Retry transfer";
  if (kind === "defer_payout") return "Defer payout";
  return kind;
}

export function resultWord(result: string): string {
  if (result === "ok") return "Simulated";
  if (result === "error") return "Failed";
  if (result === "already_done") return "Already recorded";
  return result;
}
