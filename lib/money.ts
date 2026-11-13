// Two-Key always works in major units (40000 = USD 40,000.00), matching Airwallex request
// bodies such as "transfer_amount": "50". Never pass minor units (cents) to the client.
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "IDR", "CLP", "ISK"]);

export function decimalsFor(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

/** Format a major-unit amount as the string Airwallex expects. Rejects NaN, negatives, and excess precision. */
export function toMajorString(amount: number, currency: string): string {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Invalid amount ${amount}`);
  const d = decimalsFor(currency);
  const fixed = amount.toFixed(d);
  if (Math.abs(Number(fixed) - amount) > 1e-9) {
    throw new Error(`Amount ${amount} has more than ${d} decimals for ${currency}`);
  }
  return fixed;
}

export function round(amount: number, currency: string): number {
  const f = 10 ** decimalsFor(currency);
  return Math.round(amount * f) / f;
}

/** Move available funds and recompute total. Pending and reserved are left as they are.
 *  total_amount = available + pending + reserved. This mock does not park money in those buckets. */
export function applyAvailable(balance: { currency: string; available_amount: number; pending_amount?: number; reserved_amount?: number; total_amount?: number }, delta: number) {
  balance.available_amount = round(balance.available_amount + delta, balance.currency);
  const pending = balance.pending_amount ?? 0;
  const reserved = balance.reserved_amount ?? 0;
  balance.total_amount = round(balance.available_amount + pending + reserved, balance.currency);
}
