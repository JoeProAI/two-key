import { randomUUID } from "node:crypto";
import { round } from "../money";
import { AWX_ERR, AirwallexError, type AirwallexClient, type Balance, type Conversion, type Quote, type Transfer } from "./types";
import * as fx from "./fixtures";

const VALIDITY_MS: Record<Quote["validity"], number> = {
  MIN_1: 60_000, MIN_15: 900_000, MIN_30: 1_800_000, HR_1: 3_600_000, HR_4: 14_400_000, HR_8: 28_800_000, HR_24: 86_400_000,
};

/** In-memory Airwallex double. Enforces the one rule that matters most: a request_id used before
 *  is rejected as a duplicate payout, like POST /api/v1/transfers/create does for 7 days. */
/** A quote Airwallex already issued. The real API keeps it server side; a restarted mock is told about it. */
export type IssuedQuote = Pick<Quote, "quote_id" | "buy_currency" | "sell_currency" | "buy_amount" | "valid_to_at">;

export function createMockClient(opts: { now?: () => number; transfers?: Transfer[]; balances?: Balance[]; quotes?: IssuedQuote[] } = {}): AirwallexClient & {
  calls: { createTransfer: number; createConversion: number; createQuote: number };
  conversions: Map<string, Conversion>;
  balances: Balance[];
  transfers: Map<string, Transfer>;
} {
  const now = opts.now ?? (() => fx.T0);
  const seed = opts.transfers ?? [fx.originalTransfer];
  const transfers = new Map<string, Transfer>(seed.map((t) => [t.id, { ...t }]));
  const usedRequestIds = new Set<string>(seed.map((t) => t.request_id));
  const quotes = new Map<string, Quote>();
  const conversions = new Map<string, Conversion>();
  const balances: Balance[] = (opts.balances ?? fx.balances).map((b) => ({ ...b }));
  const bal = (c: string) => {
    let b = balances.find((x) => x.currency === c);
    if (!b) balances.push((b = { currency: c, available_amount: 0 }));
    return b;
  };
  const calls = { createTransfer: 0, createConversion: 0, createQuote: 0 };
  for (const q of opts.quotes ?? []) {
    quotes.set(q.quote_id, {
      ...q, sell_amount: round(q.buy_amount / fx.EURUSD, q.sell_currency), client_rate: fx.EURUSD, validity: "MIN_15", valid_from_at: fx.iso(now()),
    });
  }

  return {
    mode: "mock",
    calls,
    balances,
    transfers,
    conversions,
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
      if (usedRequestIds.has(body.request_id)) throw new AirwallexError("duplicate request_id", 400, AWX_ERR.transferDuplicate);
      const amount = Number(body.transfer_amount);
      const src = bal(body.source_currency ?? body.transfer_currency);
      if (src.available_amount < amount) throw new AirwallexError("insufficient funds", 400, AWX_ERR.balanceInsufficient);
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
      calls.createQuote++;
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
      // Docs: reused request_id "will be rejected", no code listed. Mirroring the transfer code is an assumption (README open question).
      if (prior) throw new AirwallexError("duplicate request_id", 400, AWX_ERR.transferDuplicate);
      const q = body.quote_id ? quotes.get(body.quote_id) : undefined;
      if (body.quote_id && (!q || Date.parse(q.valid_to_at.replace("+0000", "Z")) < now())) throw new AirwallexError("quote expired", 400, AWX_ERR.conversionQuoteExpired);
      const buy = Number(body.buy_amount);
      const sell = q ? q.sell_amount : round(buy / fx.EURUSD, "EUR");
      const eur = bal(body.sell_currency);
      if (eur.available_amount < sell) throw new AirwallexError("insufficient funds", 400, AWX_ERR.balanceInsufficient);
      eur.available_amount = round(eur.available_amount - sell, eur.currency);
      const usd = bal(body.buy_currency);
      usd.available_amount = round(usd.available_amount + buy, usd.currency);
      const c: Conversion = {
        conversion_id: randomUUID(), request_id: body.request_id, buy_currency: body.buy_currency, sell_currency: body.sell_currency,
        buy_amount: buy, sell_amount: sell, quote_id: body.quote_id, status: "SETTLED", created_at: fx.iso(now()),
      };
      conversions.set(body.request_id, c);
      return { ...c };
    },
    async getConversion(conversionId) {
      for (const c of conversions.values()) if (c.conversion_id === conversionId) return { ...c };
      throw new AirwallexError("not found", 404);
    },
    async findConversionByRequestId(requestId) {
      const c = conversions.get(requestId);
      return c ? { ...c } : null;
    },
    async simulateTransferTransition(id, nextStatus) {
      const t = transfers.get(id);
      if (!t) throw new AirwallexError("not found", 404);
      t.status = nextStatus;
      return { ...t };
    },
  };
}
