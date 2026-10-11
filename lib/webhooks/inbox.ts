import type { Transfer, TransferStatus, WebhookEvent } from "../airwallex/types";

export const parseAwxTime = (s: string) => Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));

/** Webhook inbox: dedupe by event `id`, order by `created_at`, never by arrival.
 *  Airwallex may deliver the same event more than once and out of order. */
export class WebhookInbox {
  private byId = new Map<string, { event: WebhookEvent<Transfer>; arrival: number; deliveries: number }>();
  private arrivals = 0;

  /** Returns true if this is the first time we see the event id. */
  ingest(event: WebhookEvent<Transfer>): boolean {
    const seen = this.byId.get(event.id);
    if (seen) {
      seen.deliveries++;
      return false;
    }
    this.byId.set(event.id, { event, arrival: this.arrivals++, deliveries: 1 });
    return true;
  }

  duplicates(): { id: string; deliveries: number }[] {
    return [...this.byId.values()].filter((v) => v.deliveries > 1).map((v) => ({ id: v.event.id, deliveries: v.deliveries }));
  }

  /** Unique events for a transfer, ordered by created_at (ties broken by id for determinism). */
  timeline(transferId: string): WebhookEvent<Transfer>[] {
    return [...this.byId.values()]
      .map((v) => v.event)
      .filter((e) => e.data.object.id === transferId)
      .sort((a, b) => parseAwxTime(a.created_at) - parseAwxTime(b.created_at) || a.id.localeCompare(b.id));
  }

  /** Status the naive reader would believe: last event to arrive. */
  statusByArrival(transferId: string): TransferStatus | null {
    const list = [...this.byId.values()].filter((v) => v.event.data.object.id === transferId).sort((a, b) => a.arrival - b.arrival);
    return list.at(-1)?.event.data.object.status ?? null;
  }

  /** Status by created_at: the truth. */
  status(transferId: string): TransferStatus | null {
    return this.timeline(transferId).at(-1)?.data.object.status ?? null;
  }

  outOfOrder(transferId: string): boolean {
    const s = this.statusByArrival(transferId);
    return s !== null && s !== this.status(transferId);
  }
}
