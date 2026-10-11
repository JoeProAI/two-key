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
