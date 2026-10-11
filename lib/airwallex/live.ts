import "server-only";
import {
  AirwallexError,
  type AirwallexClient,
  type Balance,
  type Conversion,
  type CreateConversionBody,
  type CreateQuoteBody,
  type CreateTransferBody,
  type Quote,
  type Transfer,
  type TransferStatus,
} from "./types";

// The ONLY file that reads AIRWALLEX_CLIENT_ID / AIRWALLEX_API_KEY. It is server-only:
// importing it from a client component fails the Next build, and tests/key-leak.test.ts
// plus scripts/leak-scan.mjs check that neither the names nor the values reach a bundle.

const REFRESH_MARGIN_MS = 5 * 60_000; // refresh 5 min before expires_at

export function createLiveClient(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): AirwallexClient {
  const clientId = env.AIRWALLEX_CLIENT_ID;
  const apiKey = env.AIRWALLEX_API_KEY;
  if (!clientId || !apiKey) {
    throw new Error("AIRWALLEX_MODE=live needs AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY (server env only).");
  }
  const base = env.AIRWALLEX_BASE_URL || "https://api.sandbox.airwallex.com";
  const loginAs = env.AIRWALLEX_LOGIN_AS;
  let token: { value: string; expiresAt: number } | null = null;

  // POST /api/v1/authentication/login with headers x-client-id and x-api-key (optional x-login-as).
  // Returns 201 { token, expires_at }. Token valid 30 minutes; doc says always trust expires_at.
  async function login(): Promise<string> {
    const headers: Record<string, string> = { "x-client-id": clientId!, "x-api-key": apiKey! };
    if (loginAs) headers["x-login-as"] = loginAs;
    const res = await fetchImpl(`${base}/api/v1/authentication/login`, { method: "POST", headers });
    if (!res.ok) throw new AirwallexError("Airwallex login failed", res.status);
    const body = (await res.json()) as { token: string; expires_at?: string };
    const exp = body.expires_at ? Date.parse(body.expires_at.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")) : NaN;
    token = { value: body.token, expiresAt: Number.isFinite(exp) ? exp : Date.now() + 30 * 60_000 };
    return token.value;
  }

  async function bearer(): Promise<string> {
    if (!token || Date.now() > token.expiresAt - REFRESH_MARGIN_MS) return login();
    return token.value;
  }

  async function call<T>(method: "GET" | "POST", path: string, body?: unknown, retried = false): Promise<T> {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await bearer()}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401 && !retried) {
      token = null; // credentials_expired: log in again once
      return call<T>(method, path, body, true);
    }
    if (!res.ok) {
      let code: string | undefined;
      try {
        code = ((await res.json()) as { code?: string }).code;
      } catch {
        /* non-JSON error */
      }
      // Never include headers or env in errors.
      throw new AirwallexError(`Airwallex ${method} ${path} failed`, res.status, code);
    }
    return (await res.json()) as T;
  }

  return {
    mode: "live",
    // GET /api/v1/transfers/{id}
    getTransfer: (id) => call<Transfer>("GET", `/api/v1/transfers/${encodeURIComponent(id)}`),
    // GET /api/v1/transfers?request_id=... (list endpoint accepts request_id filter).
    // Doc: when unsure of a create outcome, "try to get a payout with this request_id".
    async findTransferByRequestId(requestId) {
      const r = await call<{ items?: Transfer[] }>("GET", `/api/v1/transfers?request_id=${encodeURIComponent(requestId)}`);
      return r.items?.[0] ?? null;
    },
    // POST /api/v1/transfers/create. On any ambiguous failure we look the request_id up
    // instead of creating again, so a timeout can never turn into a second payment.
    async createTransfer(body: CreateTransferBody) {
      try {
        return await call<Transfer>("POST", "/api/v1/transfers/create", body);
      } catch (e) {
        const existing = await this.findTransferByRequestId(body.request_id).catch(() => null);
        if (existing) return existing;
        throw e;
      }
    },
    // GET /api/v1/balances/current -> array of { currency, available_amount, pending_amount, reserved_amount, total_amount }
    getBalances: () => call<Balance[]>("GET", "/api/v1/balances/current"),
    // POST /api/v1/fx/quotes/create
    createQuote: (body: CreateQuoteBody) => call<Quote>("POST", "/api/v1/fx/quotes/create", body),
    // POST /api/v1/fx/conversions/create (request_id required; quote_id pins client_rate)
    createConversion: (body: CreateConversionBody) => call<Conversion>("POST", "/api/v1/fx/conversions/create", body),
    // Sandbox only: POST /api/v1/simulation/transfers/{id}/transition { next_status, failure_type? }
    simulateTransferTransition: (id: string, nextStatus: TransferStatus, failureType?: string) =>
      call<Transfer>("POST", `/api/v1/simulation/transfers/${encodeURIComponent(id)}/transition`, {
        next_status: nextStatus,
        ...(failureType ? { failure_type: failureType } : {}),
      }),
  };
}
