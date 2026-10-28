import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AirwallexError, type Quote, type Transfer } from "../lib/airwallex/types";
import { createLiveClient, type GlobalAccountSummary } from "../lib/airwallex/live";
import { driveFailedThenCancelled } from "../lib/airwallex/transfer-drive";
import { stableRequestId } from "../lib/requestId";
import { toMajorString } from "../lib/money";

// Sandbox proof for the day-1/2 path. Refuses to run unless AIRWALLEX_MODE=live.
// Prints status codes, ids, and boolean secret presence. Never prints tokens or key values.
//
// Endpoints (called only when that step is needed):
//   POST /api/v1/authentication/login
//   GET  /api/v1/balances/current
//   POST /api/v1/fx/quotes/create
//   GET  /api/v1/global_accounts
//   POST /api/v1/global_accounts/create
//   GET  /api/v1/global_accounts/{id}
//   POST /api/v1/simulation/deposit/create
//   GET  /api/v1/fx/conversions?request_id=
//   POST /api/v1/fx/conversions/create
//   POST /api/v1/beneficiary_api_schemas/generate
//   GET  /api/v1/beneficiaries?nick_name=
//   POST /api/v1/beneficiaries/create
//   GET  /api/v1/transfers?request_id=
//   POST /api/v1/transfers/create
//   GET  /api/v1/transfers/{id}
//   POST /api/v1/simulation/transfers/{id}/transition

const INTENT = "sandbox-smoke-v1";
const BENEFICIARY_NICK = "two-key-smoke-supplier";
const BUY_USD = 10;
const MIN_BALANCE = 40;
const TOP_UP = 100;
const FAILURE_TYPE = "BENEFICIARY_NAME_MISMATCH";
const SANDBOX_ORIGIN = "https://api.sandbox.airwallex.com";

/** Pass only when the quote, the conversion, and the transfer proof all landed. */
export function smokePassed(flags: { quoteOk: boolean; conversionOk: boolean; transferOk: boolean }): boolean {
  return flags.quoteOk && flags.conversionOk && flags.transferOk;
}

/** CANCELLED is the only transfer proof, including the auto-cancel that follows FAILED. */
export function transferProofOk(finalStatus: string): boolean {
  return finalStatus === "CANCELLED";
}

/** Exact nickname only. A list that does not contain the smoke beneficiary is not a match. */
export function smokeBeneficiaryId(listed: { id?: string; nickname?: string }[], nickname: string): string | null {
  const match = listed.find((row) => row.nickname === nickname && row.id);
  return match?.id ?? null;
}

/** `sufficient` and `deposited` may continue. `blocked` and `short` must stop before any money move. */
export function fundingReady(detail: string): boolean {
  return detail === "sufficient" || detail === "deposited";
}

/**
 * Live smoke may talk only to the Airwallex sandbox. Production (`api.airwallex.com`)
 * and any other host are refused before a client is constructed.
 */
export function sandboxBaseUrl(raw: string | undefined): string {
  const input = raw?.trim() || SANDBOX_ORIGIN;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("live-smoke: AIRWALLEX_BASE_URL is not a URL. Sandbox only.");
  }
  const pathOk = url.pathname === "" || url.pathname === "/";
  if (url.protocol !== "https:" || url.hostname !== "api.sandbox.airwallex.com" || url.username || url.password || url.search || url.hash || !pathOk) {
    throw new Error(`live-smoke: refusing host ${url.hostname || "(none)"}. Sandbox only (${SANDBOX_ORIGIN}).`);
  }
  return url.origin;
}

const SECRET_NAMES = [
  "AIRWALLEX_CLIENT_ID",
  "AIRWALLEX_API_KEY",
  "AIRWALLEX_WEBHOOK_SECRET",
  "AIRWALLEX_LOGIN_AS",
  "OPENROUTER_API_KEY",
  "TWO_KEY_INGEST_SECRET",
] as const;

const lines: string[] = [];

function redact(text: string): string {
  let out = text;
  for (const name of SECRET_NAMES) {
    const value = process.env[name];
    if (value) out = out.split(value).join("[redacted]");
  }
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, "Bearer [redacted]");
  out = out.replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted-long]");
  return out;
}

function say(line: string) {
  const safe = redact(line);
  lines.push(safe);
  console.log(safe);
}

function present(name: string): string {
  return `${name}=${process.env[name] ? "present" : "absent"}`;
}

function describeError(e: unknown): string {
  if (e instanceof AirwallexError) {
    const fields = e.fields.length ? ` fields=${e.fields.join("|")}` : "";
    const source = e.source ? ` source=${e.source}` : "";
    return redact(`${e.message} ${e.status} ${e.code ?? "no_code"} ${e.apiMessage ?? ""}${source}${fields}`.trim());
  }
  return redact(e instanceof Error ? e.message : String(e));
}

function amountNote(value: unknown): string {
  if (typeof value === "number") return `number:${value}`;
  if (typeof value === "string") return `string:${value}`;
  return typeof value;
}

function requiredPaths(schema: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const record = node as Record<string, unknown>;
    if (record.required === true && typeof record.path === "string") out.push(record.path);
    for (const value of Object.values(record)) if (value && typeof value === "object") walk(value);
  };
  walk(schema);
  return [...new Set(out)];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function supplierBeneficiary(): Record<string, unknown> {
  return {
    nickname: BENEFICIARY_NICK,
    transfer_methods: ["LOCAL"],
    payer_entity_type: "COMPANY",
    beneficiary: {
      entity_type: "COMPANY",
      type: "BANK_ACCOUNT",
      company_name: "Northwind Steel",
      address: {
        country_code: "US",
        street_address: "15 William Street",
        city: "Seattle",
        state: "WA",
        postcode: "98101",
      },
      bank_details: {
        account_currency: "USD",
        account_name: "Northwind Steel",
        bank_country_code: "US",
        account_number: "1234567890",
        account_routing_type1: "aba",
        account_routing_value1: "021000021",
        bank_account_category: "Checking",
        local_clearing_system: "ACH",
      },
    },
  };
}

const GA_COUNTRIES: Record<string, string[]> = {
  USD: ["US"],
  EUR: ["DE", "EE", "NL"],
  GBP: ["GB"],
  AUD: ["AU"],
  HKD: ["HK"],
  SGD: ["SG"],
};

async function main() {
  if (process.env.AIRWALLEX_MODE !== "live") {
    console.error("live-smoke: set AIRWALLEX_MODE=live. Mock mode does not call the sandbox.");
    process.exit(2);
  }

  const base = sandboxBaseUrl(process.env.AIRWALLEX_BASE_URL);
  process.env.AIRWALLEX_BASE_URL = base;
  say(`live-smoke intent=${INTENT}`);
  say(`base=${base}`);
  say(`secrets ${SECRET_NAMES.map(present).join(" ")}`);
  say("OPENROUTER_API_KEY and AIRWALLEX_WEBHOOK_SECRET are not required for this smoke.");

  const client = createLiveClient();
  let quoteOk = false;
  let conversionOk = false;
  let transferOk = false;

  const auth = await client.authenticate();
  say(`POST /api/v1/authentication/login ${auth.httpStatus}`);
  if (auth.httpStatus !== 201 && auth.httpStatus !== 200) {
    throw new Error(`login HTTP ${auth.httpStatus}`);
  }

  let balances = await client.getBalances();
  say(`GET /api/v1/balances/current ok ${balances.map((b) => `${b.currency}=${b.available_amount}`).join(" ") || "(none)"}`);

  const quotePairs: { buy: string; sell: string }[] = [
    { buy: "USD", sell: "EUR" },
    { buy: "EUR", sell: "USD" },
    { buy: "USD", sell: "GBP" },
    { buy: "GBP", sell: "USD" },
    { buy: "USD", sell: "AUD" },
  ];
  let quote: Quote | null = null;
  let quotePair = quotePairs[0];
  for (const pair of quotePairs) {
    try {
      quote = await client.createQuote({
        buy_currency: pair.buy,
        sell_currency: pair.sell,
        buy_amount: BUY_USD,
        validity: "MIN_15",
      });
      quotePair = pair;
      quoteOk = true;
      say(
        `POST /api/v1/fx/quotes/create ok quote_id=${quote.quote_id} ${pair.sell}->${pair.buy} client_rate=${quote.client_rate} buy=${amountNote(quote.buy_amount)} sell=${amountNote(quote.sell_amount)} valid_to=${quote.valid_to_at}`,
      );
      break;
    } catch (e) {
      say(`POST /api/v1/fx/quotes/create ${pair.sell}->${pair.buy} FAIL ${describeError(e)}`);
    }
  }
  if (!quote || !quoteOk) throw new Error("no FX quote succeeded");

  const need = new Set<string>([quotePair.sell, "USD"]);
  for (const currency of need) {
    balances = await client.getBalances();
    const have = balances.find((b) => b.currency === currency)?.available_amount ?? 0;
    if (have >= MIN_BALANCE) {
      say(`balance ${currency}=${have} sufficient (no deposit)`);
      continue;
    }
    const funded = await ensureCurrency(client, currency);
    say(`fund ${currency} ${funded}`);
    if (!fundingReady(funded)) {
      throw new Error(`funding ${currency} not ready (${funded}); stopping before conversion and transfer`);
    }
  }

  balances = await client.getBalances();
  say(`GET /api/v1/balances/current ok ${balances.map((b) => `${b.currency}=${b.available_amount}`).join(" ") || "(none)"}`);

  const conversionRequestId = stableRequestId(INTENT, "fx_conversion");
  say(`conversion request_id=${conversionRequestId}`);
  try {
    const existing = await client.findConversionByRequestId(conversionRequestId);
    if (existing && existing.status !== "CANCELLED") {
      conversionOk = true;
      say(`GET /api/v1/fx/conversions?request_id= ok already_done conversion_id=${existing.conversion_id} status=${existing.status} (no second create)`);
    } else if (existing) {
      say(`GET /api/v1/fx/conversions?request_id= ok conversion_id=${existing.conversion_id} status=CANCELLED; not creating another`);
    } else {
      const freshForConversion = await client.createQuote({
        buy_currency: quotePair.buy,
        sell_currency: quotePair.sell,
        buy_amount: BUY_USD,
        validity: "MIN_15",
      });
      say(`POST /api/v1/fx/quotes/create ok quote_id=${freshForConversion.quote_id} (fresh, for the conversion)`);
      const created = await client.createConversion({
        request_id: conversionRequestId,
        buy_currency: quotePair.buy,
        sell_currency: quotePair.sell,
        buy_amount: toMajorString(BUY_USD, quotePair.buy),
        quote_id: freshForConversion.quote_id,
      });
      conversionOk = true;
      say(
        `POST /api/v1/fx/conversions/create ok conversion_id=${created.conversion_id} status=${created.status} request_id=${created.request_id} buy=${amountNote(created.buy_amount)} sell=${amountNote(created.sell_amount)}`,
      );
    }
  } catch (e) {
    say(`fx conversion FAIL ${describeError(e)}`);
  }

  const transferRequestId = stableRequestId(INTENT, "retry_transfer");
  say(`transfer request_id=${transferRequestId}`);
  try {
    const existing = await client.findTransferByRequestId(transferRequestId);
    let transfer: Transfer;
    if (existing) {
      say(`GET /api/v1/transfers?request_id= ok already_done id=${existing.id} status=${existing.status} (no second create)`);
      transfer = existing;
    } else {
      const beneficiaryId = await ensureBeneficiary(client);
      say(`beneficiary_id=${beneficiaryId}`);
      transfer = await client.createTransfer({
        request_id: transferRequestId,
        beneficiary_id: beneficiaryId,
        transfer_amount: toMajorString(BUY_USD, "USD"),
        transfer_currency: "USD",
        source_currency: "USD",
        transfer_method: "LOCAL",
        reference: "INV-SMOKE",
        reason: "bill_payment",
      });
      say(`POST /api/v1/transfers/create ok id=${transfer.id} status=${transfer.status} amount=${amountNote(transfer.transfer_amount)} request_id=${transfer.request_id}`);
    }
    transferOk = await driveTransfer(client, transfer);
  } catch (e) {
    say(`transfer path FAIL ${describeError(e)}`);
  }

  const pass = smokePassed({ quoteOk, conversionOk, transferOk });
  say(`result ${pass ? "pass" : "fail"} quote=${quoteOk} conversion=${conversionOk} transfer=${transferOk}`);
  writeFileSync("/tmp/two-key-live-smoke.txt", lines.join("\n") + "\n");
  if (!pass) process.exitCode = 1;
}

async function ensureCurrency(
  client: ReturnType<typeof createLiveClient>,
  currency: string,
): Promise<string> {
  const countries = GA_COUNTRIES[currency];
  if (!countries) return `blocked no country map for ${currency}`;
  let accounts: GlobalAccountSummary[];
  try {
    accounts = await client.listGlobalAccounts();
    say(`GET /api/v1/global_accounts ok count=${accounts.length} ${accounts.map((a) => `${a.id}:${a.country_code}:${a.status}:${a.currencies.join("+")}`).join(" ")}`);
  } catch (e) {
    say(`GET /api/v1/global_accounts FAIL ${describeError(e)}`);
    return "blocked list";
  }
  let account = accounts.find((a) => a.currencies.includes(currency) && a.status !== "CLOSED" && a.status !== "FAILED");
  if (!account) {
    for (const country of countries) {
      const requestId = stableRequestId(INTENT, "global_account", `${country}-${currency}`);
      try {
        account = await client.createGlobalAccount({
          country_code: country,
          request_id: requestId,
          nick_name: `two-key-smoke-${currency.toLowerCase()}`,
          required_features: [{ currency, transfer_method: "LOCAL" }],
        });
        say(`POST /api/v1/global_accounts/create ok id=${account.id} country=${country} currency=${currency} status=${account.status} request_id=${requestId}`);
        break;
      } catch (e) {
        say(`POST /api/v1/global_accounts/create ${country} ${currency} FAIL ${describeError(e)}`);
        const again = await client.listGlobalAccounts().catch(() => []);
        account = again.find((a) => a.nick_name === `two-key-smoke-${currency.toLowerCase()}` && a.currencies.includes(currency))
          ?? again.find((a) => a.currencies.includes(currency) && a.status !== "CLOSED" && a.status !== "FAILED");
        if (account) {
          say(`reused global_account id=${account.id} status=${account.status} after create error`);
          break;
        }
      }
    }
  } else {
    say(`reused global_account id=${account.id} country=${account.country_code} status=${account.status} currencies=${account.currencies.join("+")}`);
  }
  if (!account) return "blocked no global account";

  for (let i = 0; i < 8 && account.status && account.status !== "ACTIVE"; i++) {
    await sleep(2000);
    try {
      account = await client.getGlobalAccount(account.id);
      say(`GET /api/v1/global_accounts/${account.id} status=${account.status}`);
    } catch (e) {
      say(`GET /api/v1/global_accounts/${account.id} FAIL ${describeError(e)}`);
      break;
    }
    if (account.status === "FAILED" || account.status === "CLOSED") break;
  }

  const reference = `two-key-${currency}-${Date.now()}`;
  try {
    const deposit = await client.simulateDeposit({
      amount: TOP_UP,
      global_account_id: account.id,
      payer_name: "Two-Key smoke",
      reference,
      status: "SETTLED",
    });
    say(`POST /api/v1/simulation/deposit/create ok id=${deposit.id ?? "none"} currency=${deposit.currency ?? "?"} amount=${amountNote(deposit.amount)} status=${deposit.status} global_account_id=${account.id}`);
  } catch (e) {
    say(`POST /api/v1/simulation/deposit/create FAIL ${describeError(e)}`);
    return "blocked deposit";
  }
  const after = await client.getBalances();
  const have = after.find((b) => b.currency === currency)?.available_amount ?? 0;
  say(`balance after deposit ${currency}=${have}`);
  return have >= MIN_BALANCE ? "deposited" : `short after deposit (${have})`;
}

async function ensureBeneficiary(client: ReturnType<typeof createLiveClient>): Promise<string> {
  const listed = await client.listBeneficiaries(BENEFICIARY_NICK);
  const existingId = smokeBeneficiaryId(listed, BENEFICIARY_NICK);
  if (existingId) {
    say(`GET /api/v1/beneficiaries?nick_name= ok reused id=${existingId} nickname=${BENEFICIARY_NICK}`);
    return existingId;
  }
  try {
    const schema = await client.generateBeneficiarySchema({
      type: "BANK_ACCOUNT",
      entity_type: "COMPANY",
      bank_country_code: "US",
      account_currency: "USD",
      transfer_method: "LOCAL",
      local_clearing_system: "ACH",
    });
    const paths = requiredPaths(schema);
    say(`POST /api/v1/beneficiary_api_schemas/generate ok required_paths=${paths.join("|") || "(none parsed)"}`);
  } catch (e) {
    say(`POST /api/v1/beneficiary_api_schemas/generate FAIL ${describeError(e)}`);
  }
  const created = await client.createBeneficiary(supplierBeneficiary());
  say(`POST /api/v1/beneficiaries/create ok id=${created.id}`);
  return created.id;
}

async function driveTransfer(client: ReturnType<typeof createLiveClient>, transfer: Transfer): Promise<boolean> {
  const drive = await driveFailedThenCancelled(client, transfer.id, FAILURE_TYPE);
  const hop = drive.hops.join(",");
  const call = hop === "already CANCELLED"
    ? `GET /api/v1/transfers/${transfer.id}`
    : `POST /api/v1/simulation/transfers/${transfer.id}/transition`;
  say(`${call} final=${drive.finalStatus} auto_cancelled=${drive.autoCancelled} hops=${hop}`);
  if (!transferProofOk(drive.finalStatus)) {
    throw new Error(`transfer ${transfer.id} final=${drive.finalStatus}; smoke requires CANCELLED`);
  }
  return true;
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry && entry === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    say(`result fail ${describeError(e)}`);
    try {
      writeFileSync("/tmp/two-key-live-smoke.txt", lines.join("\n") + "\n");
    } catch {
      /* report is best-effort */
    }
    process.exit(1);
  });
}
