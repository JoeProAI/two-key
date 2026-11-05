const SECRET_KEY = /secret|api[_-]?key|token|password|authorization|cookie/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const LONG_DIGITS = /\d(?:[\s-]?\d){11,}/g;

/** Strip secrets, emails, and long account-like numbers from a JSON value. Provider ids and request ids stay. */
export function redact<T>(value: T): T {
  return walk(value) as T;
}

function walk(value: unknown, key = ""): unknown {
  if (SECRET_KEY.test(key)) return "[redacted]";
  if (typeof value === "string") return scrub(value);
  if (Array.isArray(value)) return value.map((item) => walk(item));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = walk(v, k);
    return out;
  }
  return value;
}

function scrub(text: string): string {
  return text.replace(EMAIL, "[redacted-email]").replace(LONG_DIGITS, "[redacted-number]");
}
