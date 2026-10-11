import { randomUUID } from "node:crypto";
import { round } from "../money";
import { AirwallexError, type AirwallexClient, type Balance, type Conversion, type Quote, type Transfer } from "./types";
import * as fx from "./fixtures";

const VALIDITY_MS: Record<Quote["validity"], number> = {
  MIN_1: 60_000, MIN_15: 900_000, MIN_30: 1_800_000, HR_1: 3_600_000, HR_4: 14_400_000, HR_8: 28_800_000, HR_24: 86_400_000,
};

/** In-memory Airwallex double. Enforces the one rule that matters most: a request_id used before
 *  is rejected as a duplicate payout, like POST /api/v1/transfers/create does for 7 days. */
export function createMockClient(opts: { now?: () => number } = {}): AirwallexClient & {
  calls: { createTransfer: number; createConversion: number };
  balances: Balance[];
  transfers: Map<string, Transfer>;
} {
  const now = opts.now ?? (() => fx.T0);
  const transfers = new Map<string, Transfer>([[fx.originalTransfer.id, { ...fx.originalTransfer }]]);
  const usedRequestIds = new Set<string>([fx.originalTransfer.request_id]);
  const quotes = new Map<string, Quote>();
  const conversions = new Map<string, Conversion>();
  const balances: Balance[] = fx.balances.map((b) => ({ ...b }));
  const bal = (c: string) => {
    let b = balances.find((x) => x.currency === c);
    if (!b) balances.push((b = { currency: c, available_amount: 0 }));
    return b;
  };
  const calls = { createTransfer: 0, createConversion: 0 };

  return {
    mode: "mock",
    calls,
    balances,
    transfers,
    async getTransfer(id) {
      const t = transfers.get(id);
      if (!t) throw new AirwallexError("not found", 404);
      return { ...t };
    },
    async findTransferByRequestId(requestId) {
      for (const t of transfers.values()) if (t.request_id === requestId) return { ...t };
      return null;
    },
    async createTransfer(body) {
      calls.createTransfer++;
      if (usedRequestIds.has(body.request_id)) throw new AirwallexError("duplicate request_id", 400, "duplicate_request");
      const amount = Number(body.transfer_amount);
      const src = bal(body.source_currency ?? body.transfer_currency);
      if (src.available_amount < amount) throw new AirwallexError("insufficient funds", 400, "insufficient_fund");
      usedRequestIds.add(body.request_id);
      src.available_amount = round(src.available_amount - amount, src.currency);
      const t: Transfer = {
        id: randomUUID(), request_id: body.request_id, status: "PROCESSING", transfer_amount: amount,
        transfer_currency: body.transfer_currency, source_currency: body.source_currency, beneficiary_id: body.beneficiary_id,
        reference: body.reference, created_at: fx.iso(now()),
      };
      transfers.set(t.id, t);
      return { ...t };
    },
    async getBalances() {
      return balances.map((b) => ({ ...b }));
    },
    async createQuote(body) {
      if ((body.buy_amount === undefined) === (body.sell_amount === undefined)) throw new AirwallexError("set exactly one of buy_amount/sell_amount", 400);
      if (!(body.buy_currency === "USD" && body.sell_currency === "EUR")) throw new AirwallexError("mock supports EUR->USD only", 400);
      const buy = body.buy_amount ?? round(body.sell_amount! * fx.EURUSD, "USD");
      const sell = body.sell_amount ?? round(body.buy_amount! / fx.EURUSD, "EUR");
      const q: Quote = {
        quote_id: randomUUID(), buy_currency: "USD", sell_currency: "EUR", buy_amount: buy, sell_amount: sell,
        client_rate: fx.EURUSD, validity: body.validity, valid_from_at: fx.iso(now()), valid_to_at: fx.iso(now() + VALIDITY_MS[body.validity]),
      };
      quotes.set(q.quote_id, q);
      return { ...q };
    },
    async createConversion(body) {
      calls.createConversion++;
      const prior = conversions.get(body.request_id);
      if (prior) throw new AirwallexError("duplicate request_id", 400, "duplicate_request");
      const q = body.quote_id ? quotes.get(body.quote_id) : undefined;
      if (body.quote_id && (!q || Date.parse(q.valid_to_at.replace("+0000", "Z")) < now())) throw new AirwallexError("quote expired", 400, "quote_expired");
      const buy = Number(body.buy_amount);
      const sell = q ? q.sell_amount : round(buy / fx.EURUSD, "EUR");
      const eur = bal(body.sell_currency);
      if (eur.available_amount < sell) throw new AirwallexError("insufficient funds", 400, "insufficient_fund");
      eur.available_amount = round(eur.available_amount - sell, eur.currency);
      const usd = bal(body.buy_currency);
      usd.available_amount = round(usd.available_amount + buy, usd.currency);
      const c: Conversion = {
        conversion_id: randomUUID(), request_id: body.request_id, buy_currency: body.buy_currency, sell_currency: body.sell_currency,
        buy_amount: buy, sell_amount: sell, quote_id: body.quote_id, status: "SETTLED",
      };
      conversions.set(body.request_id, c);
      return { ...c };
    },
    async simulateTransferTransition(id, nextStatus) {
      const t = transfers.get(id);
      if (!t) throw new AirwallexError("not found", 404);
      t.status = nextStatus;
      return { ...t };
    },
  };
}
