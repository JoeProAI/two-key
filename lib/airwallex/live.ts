import "server-only";
import {
  AirwallexError,
  type AirwallexClient,
  type Balance,
  type Conversion,
  type ConversionList,
  type TransferList,
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
const SANDBOX_HOST = "api.sandbox.airwallex.com";

/** Live calls may use only the Airwallex sandbox host. Production and any other host are refused. */
export function sandboxOrigin(raw: string | undefined): string {
  const input = raw?.trim() || `https://${SANDBOX_HOST}`;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("AIRWALLEX_BASE_URL is not a URL. Sandbox only.");
  }
  if (url.protocol !== "https:" || url.hostname !== SANDBOX_HOST || url.username || url.password) {
    throw new Error(`Refusing host ${url.hostname || "(none)"}. Sandbox only (https://${SANDBOX_HOST}).`);
  }
  return url.origin;
}

/** Names only. Empty when the sandbox client can be constructed. Does not read or print values. */
export function missingSandboxEnv(env: NodeJS.ProcessEnv): string[] {
  const names = ["AIRWALLEX_CLIENT_ID", "AIRWALLEX_API_KEY"] as const;
  return names.filter((name) => !env[name]);
}

export interface SandboxOps {
  /** POST /api/v1/authentication/login. Returns the HTTP status only, never the token. */
  authenticate(): Promise<{ httpStatus: number }>;
  listBeneficiaries(nickname?: string): Promise<BeneficiarySummary[]>;
  createBeneficiary(body: Record<string, unknown>): Promise<{ id: string }>;
  generateBeneficiarySchema(body: Record<string, unknown>): Promise<unknown>;
  listGlobalAccounts(): Promise<GlobalAccountSummary[]>;
  createGlobalAccount(body: CreateGlobalAccountBody): Promise<GlobalAccountSummary>;
  getGlobalAccount(id: string): Promise<GlobalAccountSummary>;
  simulateDeposit(body: SimulateDepositBody): Promise<{ id?: string; status?: string; currency?: string; amount?: number }>;
}

export function createLiveClient(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): AirwallexClient & SandboxOps {
  const clientId = env.AIRWALLEX_CLIENT_ID;
  const apiKey = env.AIRWALLEX_API_KEY;
  if (!clientId || !apiKey) {
    throw new Error("AIRWALLEX_MODE=live needs AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY (server env only).");
  }
  const base = sandboxOrigin(env.AIRWALLEX_BASE_URL);
  const loginAs = env.AIRWALLEX_LOGIN_AS;
  let token: { value: string; expiresAt: number } | null = null;

  // POST /api/v1/authentication/login with headers x-client-id and x-api-key (optional x-login-as).
  // Returns 201 { token, expires_at }. Token valid 30 minutes; doc says always trust expires_at.
  let lastLoginStatus = 0;

  async function login(): Promise<string> {
    const headers: Record<string, string> = { "x-client-id": clientId!, "x-api-key": apiKey! };
    if (loginAs) headers["x-login-as"] = loginAs;
    const res = await fetchImpl(`${base}/api/v1/authentication/login`, { method: "POST", headers });
    lastLoginStatus = res.status;
    if (!res.ok) {
      const err = await readError(res);
      throw new AirwallexError("Airwallex login failed", res.status, err.code, err.apiMessage, err.source, err.fields);
    }
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
      // Error body per docs/api/errors.md: { code, source, message, details }.
      // Keep message/source/field paths off Error.message. Never include headers or env.
      const err = await readError(res);
      throw new AirwallexError(`Airwallex ${method} ${path} failed`, res.status, err.code, err.apiMessage, err.source, err.fields);
    }
    return (await res.json()) as T;
  }

  return {
    mode: "live",
    // GET /api/v1/transfers/{id}
    getTransfer: (id) => call<Transfer>("GET", `/api/v1/transfers/${encodeURIComponent(id)}`),
    // GET /api/v1/transfers?request_id=... (docs/api/payouts/transfers/list.md: `request_id` query param,
    // response { items, page_after, page_before }). Doc: when unsure of a create outcome,
    // "try to get a payout with this request_id".
    async findTransferByRequestId(requestId) {
      const r = await call<TransferList>("GET", `/api/v1/transfers?request_id=${encodeURIComponent(requestId)}`);
      return r.items?.find((t) => t.request_id === requestId) ?? null;
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
    // POST /api/v1/fx/conversions/create (request_id required; quote_id pins client_rate).
    // Same safety net as transfers: on any failure, look the request_id up before giving up.
    async createConversion(body: CreateConversionBody) {
      try {
        return await call<Conversion>("POST", "/api/v1/fx/conversions/create", body);
      } catch (e) {
        const existing = await this.findConversionByRequestId(body.request_id).catch(() => null);
        if (existing) return existing;
        throw e;
      }
    },
    // GET /api/v1/fx/conversions/{conversion_id} (docs/api/transactional_fx/conversion/retrieve.md)
    getConversion: (id: string) => call<Conversion>("GET", `/api/v1/fx/conversions/${encodeURIComponent(id)}`),
    // GET /api/v1/fx/conversions?request_id=... (docs/api/transactional_fx/conversion/list.md: `request_id` query param,
    // "Client-supplied conversion request_id"; response { has_more, items }). With no date filter the list covers
    // the last 31 days, which is longer than any Two-Key intent lives.
    async findConversionByRequestId(requestId) {
      const r = await call<ConversionList>("GET", `/api/v1/fx/conversions?request_id=${encodeURIComponent(requestId)}`);
      return r.items?.find((c) => c.request_id === requestId) ?? null;
    },
    // Sandbox only: POST /api/v1/simulation/transfers/{id}/transition { next_status, failure_type? }
    simulateTransferTransition: (id: string, nextStatus: TransferStatus, failureType?: string) =>
      call<Transfer>("POST", `/api/v1/simulation/transfers/${encodeURIComponent(id)}/transition`, {
        next_status: nextStatus,
        ...(failureType ? { failure_type: failureType } : {}),
      }),

    // Proves POST /api/v1/authentication/login without returning the token.
    async authenticate() {
      await login();
      return { httpStatus: lastLoginStatus };
    },

    // GET /api/v1/beneficiaries. Projects away bank details; callers only need an id to reuse.
    async listBeneficiaries(nickname?: string) {
      const q = new URLSearchParams({ page_size: "100" });
      if (nickname) q.set("nick_name", nickname);
      const body = await call<ListBody<RawBeneficiary> | RawBeneficiary[]>("GET", `/api/v1/beneficiaries?${q}`);
      return unwrapItems(body).map((b) => ({
        id: b.id,
        nickname: b.nickname ?? b.nick_name,
        transfer_methods: b.transfer_methods,
      }));
    },

    // POST /api/v1/beneficiaries/create. Returns the id only.
    async createBeneficiary(body: Record<string, unknown>) {
      const created = await call<{ id?: string; beneficiary_id?: string }>("POST", "/api/v1/beneficiaries/create", body);
      const id = created.id ?? created.beneficiary_id;
      if (!id) throw new AirwallexError("Airwallex POST /api/v1/beneficiaries/create returned no id", 200);
      return { id };
    },

    // POST /api/v1/beneficiary_api_schemas/generate. Schema of required fields for one payout scenario.
    generateBeneficiarySchema: (body: Record<string, unknown>) =>
      call<unknown>("POST", "/api/v1/beneficiary_api_schemas/generate", body),

    // GET /api/v1/global_accounts. Projects away account_number and iban.
    async listGlobalAccounts() {
      const body = await call<ListBody<RawGlobalAccount> | RawGlobalAccount[]>("GET", "/api/v1/global_accounts?page_size=100");
      return unwrapItems(body).map(projectGlobalAccount);
    },

    // POST /api/v1/global_accounts/create. request_id must be stable per currency so a retry cannot open a second account.
    async createGlobalAccount(body: CreateGlobalAccountBody) {
      const created = await call<RawGlobalAccount>("POST", "/api/v1/global_accounts/create", body);
      return projectGlobalAccount(created);
    },

    // GET /api/v1/global_accounts/{id}
    async getGlobalAccount(id: string) {
      const got = await call<RawGlobalAccount>("GET", `/api/v1/global_accounts/${encodeURIComponent(id)}`);
      return projectGlobalAccount(got);
    },

    // Sandbox only: POST /api/v1/simulation/deposit/create. `amount` is major units (100 = 100.00).
    async simulateDeposit(body: SimulateDepositBody) {
      const created = await call<{ id?: string; status?: string; currency?: string; amount?: number | string }>(
        "POST",
        "/api/v1/simulation/deposit/create",
        {
          amount: body.amount,
          global_account_id: body.global_account_id,
          ...(body.payer_name ? { payer_name: body.payer_name } : {}),
          ...(body.reference ? { reference: body.reference } : {}),
          ...(body.status ? { status: body.status } : {}),
        },
      );
      return {
        id: created.id,
        status: created.status,
        currency: created.currency,
        amount: typeof created.amount === "string" ? Number(created.amount) : created.amount,
      };
    },
  };
}

type ErrorFields = { code?: string; apiMessage?: string; source?: string; fields: string[] };

async function readError(res: Response): Promise<ErrorFields> {
  try {
    return parseError(await res.json());
  } catch {
    return { fields: [] };
  }
}

function parseError(payload: unknown): ErrorFields {
  if (!payload || typeof payload !== "object") return { fields: [] };
  const body = payload as Record<string, unknown>;
  const fields: string[] = [];
  const walk = (node: unknown, depth: number) => {
    if (depth > 5 || fields.length >= 20 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const o = node as Record<string, unknown>;
    for (const key of ["source", "field", "path"]) {
      const v = o[key];
      if (typeof v === "string" && v.length > 0 && v.length < 160 && !fields.includes(v)) fields.push(v);
    }
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v, depth + 1);
  };
  walk(body.details, 0);
  return {
    code: typeof body.code === "string" ? body.code : undefined,
    apiMessage: typeof body.message === "string" ? body.message.slice(0, 300) : undefined,
    source: typeof body.source === "string" ? body.source.slice(0, 120) : undefined,
    fields,
  };
}

interface ListBody<T> { items?: T[] }
function unwrapItems<T>(body: ListBody<T> | T[] | null | undefined): T[] {
  if (Array.isArray(body)) return body;
  return body?.items ?? [];
}

interface RawBeneficiary {
  id: string;
  nickname?: string;
  nick_name?: string;
  transfer_methods?: string[];
}

interface RawGlobalAccount {
  id: string;
  status?: string;
  country_code?: string;
  nick_name?: string;
  required_features?: { currency?: string }[];
  supported_features?: { currency?: string }[];
}

export interface BeneficiarySummary {
  id: string;
  nickname?: string;
  transfer_methods?: string[];
}

export interface GlobalAccountSummary {
  id: string;
  status?: string;
  country_code?: string;
  nick_name?: string;
  currencies: string[];
}

export interface CreateGlobalAccountBody {
  country_code: string;
  request_id: string;
  nick_name?: string;
  required_features: { currency: string; transfer_method?: "LOCAL" | "SWIFT" }[];
}

export interface SimulateDepositBody {
  amount: number;
  global_account_id: string;
  payer_name?: string;
  reference?: string;
  status?: "PENDING" | "REJECTED" | "SETTLED";
}

function projectGlobalAccount(g: RawGlobalAccount): GlobalAccountSummary {
  const currencies = [
    ...(g.required_features ?? []).map((f) => f.currency),
    ...(g.supported_features ?? []).map((f) => f.currency),
  ].filter((c): c is string => Boolean(c));
  return {
    id: g.id,
    status: g.status,
    country_code: g.country_code,
    nick_name: g.nick_name,
    currencies: [...new Set(currencies)],
  };
}
