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
  /** After a restore, new ids continue past the restored ones. */
  reserveIds(ids: string[]) {
    for (const id of ids) this.n = Math.max(this.n, Number(id.match(/_(\d+)$/)?.[1] ?? 0));
  }
  /** Executions are unique by request_id: the local half of "never pay twice". */
  executionByRequestId(requestId: string) {
    return this.executions.find((e) => e.requestId === requestId && e.result !== "error");
  }
}
