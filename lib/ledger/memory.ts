import type { Decision, Execution, Intent, Objection, Proposal, Receipt } from "./types";

export class MemoryLedger {
  intents: Intent[] = [];
  proposals: Proposal[] = [];
  objections: Objection[] = [];
  decisions: Decision[] = [];
  executions: Execution[] = [];
  receipts: Receipt[] = [];
  private n = 0;
  id(prefix: string) {
    return `${prefix}_${++this.n}`;
  }
  /** Executions are unique by request_id: the local half of "never pay twice". */
  executionByRequestId(requestId: string) {
    return this.executions.find((e) => e.requestId === requestId && e.result !== "error");
  }
}
