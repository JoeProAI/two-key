# Ops note

Secret values are not in this note.

## Live auth (2026-10-27)

Checked on a fresh VM. `AIRWALLEX_MODE` and `AIRWALLEX_BASE_URL` were unset in the VM environment. The proof process set `AIRWALLEX_MODE=live` and `AIRWALLEX_BASE_URL=https://api.sandbox.airwallex.com`. `lib/airwallex/live.ts` is the only code that read the client id and API key.

| Name | Set |
|---|---|
| `AIRWALLEX_CLIENT_ID` | yes |
| `AIRWALLEX_API_KEY` | yes |

`createLiveClient` from `lib/airwallex/live.ts`, then `getBalances()`:

| Call | Result |
|---|---|
| `POST /api/v1/authentication/login` | 201 |
| `GET /api/v1/balances/current` | 200 |

The balances response was an array of 46 currency rows. Non-zero `available_amount` (sandbox wallet, major units): USD 10000000, EUR 10000000, GBP 10000000, CNY 10000000. Every other currency in the array was 0 available, pending, and reserved.

No token, client id, or API key was printed or written down.

## Live smoke (2026-10-27)

Host: `https://api.sandbox.airwallex.com`. Command: `AIRWALLEX_MODE=live npm run live-smoke`.

Secrets are boolean only. `AIRWALLEX_CLIENT_ID` present. `AIRWALLEX_API_KEY` present. `AIRWALLEX_LOGIN_AS` absent. `AIRWALLEX_WEBHOOK_SECRET` absent. `OPENROUTER_API_KEY` absent. `TWO_KEY_INGEST_SECRET` absent. Nothing here is blocked on Joe. The LLM path and webhook subscription were not part of this smoke.

`npm run check` stays on `AIRWALLEX_MODE=mock` and does not call the sandbox. `npm run live-smoke` exits 2 unless `AIRWALLEX_MODE=live`.

### What passed

| Step | Endpoint | Result |
|---|---|---|
| Login | `POST /api/v1/authentication/login` | 201. Token is not printed. |
| Balances | `GET /api/v1/balances/current` | 200. Wallet already funded. No deposit was required. |
| FX quote | `POST /api/v1/fx/quotes/create` | 200. EUR to USD, `buy_amount` 10 (number, major units), `validity` `MIN_15`. |
| Conversion lookup | `GET /api/v1/fx/conversions?request_id=` | 200. Second run returned the existing conversion and did not create another. |
| Conversion create | `POST /api/v1/fx/conversions/create` | 201 on the first run. `status` `SETTLED`. Amounts came back as numbers. |
| Beneficiary schema | `POST /api/v1/beneficiary_api_schemas/generate` | 200. US company, USD, `LOCAL`, `ACH`. |
| Beneficiary create | `POST /api/v1/beneficiaries/create` | 201. Reused by nickname on a later run; not created twice. |
| Transfer lookup | `GET /api/v1/transfers?request_id=` | 200. Second run returned the existing transfer and did not create another. |
| Transfer create | `POST /api/v1/transfers/create` | 201 on the first run. `reason` `bill_payment`. Amount `"10.00"` in, `10` number out. |
| Transition to SENT | `POST /api/v1/simulation/transfers/{id}/transition` | 200 from `PROCESSING`. |
| Transition to FAILED | same, `next_status` `FAILED`, `failure_type` `BENEFICIARY_NAME_MISMATCH` | 200 from `SENT`. `failure_reason` `90301: Beneficiary name mismatch`. |
| Read-back | `GET /api/v1/transfers/{id}` | 200. Status was already `CANCELLED` on the GET immediately after FAILED. |

Final smoke line: `result pass quote=true conversion=true transfer=true`.

### Ids (not secrets)

- Quote used to prove the endpoint: `878e1b2c-070a-3b39-9b69-0a60291f9ec6`. EUR to USD, `client_rate` 1.110468, buy 10, sell 9.01, `valid_to` `2026-10-27T02:42:03+0000`.
- Quote pinned on the conversion: `fb86eded-dbc4-34c9-a0fd-32820b45eb47`.
- Conversion `request_id` `f132a3c9-b310-d548-9fa1-6a093b50ff07` (`sha256` of intent `sandbox-smoke-v1` + action `fx_conversion`). `conversion_id` `32a3bfa6-0c1e-408b-986e-84a45f472449`. Buy 10 USD, sell 9.01 EUR, `SETTLED`.
- Beneficiary `615b1a81-c894-4612-a986-eb6d57f9abdd`, nickname `two-key-smoke-supplier`.
- Transfer `request_id` `3babcf23-416f-c127-fd7e-7a38780182f5` (same intent, action `retry_transfer`). `id` `4e1dab1a-c59b-413b-92d5-813f6caafd59`. Reference `INV-SMOKE`. 10 USD, fee 0, `transfer_date` `2026-10-26`.

No global account was created. No deposit was simulated. Starting balances that mattered: USD 10000000, EUR 10000000, GBP 10000000, CNY 10000000. After the conversion: EUR 9999990.99, USD 10000010. After the transfer was created, failed, and auto-cancelled, USD was still 10000010, so the 10 USD payout was returned. A later run left both balances unchanged.

### What failed, and the hop that worked

`FAILED` is not a legal next status from `SCHEDULED` or `PROCESSING` on this account. Both returned 500 `operation_failed` and the status did not change. `PROCESSING` to `SENT` returned 200. `SENT` to `FAILED` returned 200.

The transfer was `SCHEDULED` on create, with `funding.status` `FUNDED`, and had moved to `PROCESSING` on its own a few seconds later.

An explicit `CANCELLED` transition after the auto-cancel returned 500 `operation_failed`. The GET stayed `CANCELLED`. The smoke treats that GET as success and does not call `CANCELLED` again. `lib/airwallex/transfer-drive.ts` is the hop order the script now uses: wait out `SCHEDULED`, `SENT`, then `FAILED`, then read back.

`x-api-version` `2024-06-30` and `2024-04-30` on the transfer simulation path returned 404 and told us to use `POST /api/v1/simulation/payments/{payment_id}/transition`. The account's default version (no `x-api-version` header) is the one that works. The client does not pin an old version.

The first beneficiary create returned 400 `validation_failed` on `beneficiary.bank_details.bank_account_category`. The schema marks that path required for this US ACH company payout. Retry with `bank_account_category` `Checking` returned 201. No transfer existed yet, so the stable transfer `request_id` was not consumed by the 400.

### Still open

- Whether `payout.transfer.cancelled` is actually delivered. The status flip to `CANCELLED` is confirmed. No webhook was subscribed, and `AIRWALLEX_WEBHOOK_SECRET` is absent.
- The HTTP code for a duplicate `request_id` on `POST /api/v1/fx/conversions/create`. The smoke looks the id up first, so it never sent the duplicate.
- `OPENROUTER_API_KEY` is absent, so the LLM planner and Wringer were not run against live data.

### Rerun

The second `npm run live-smoke` printed `already_done` for conversion `32a3bfa6-0c1e-408b-986e-84a45f472449` (`SETTLED`) and transfer `4e1dab1a-c59b-413b-92d5-813f6caafd59` (`CANCELLED`). Hops: `already CANCELLED`. No second create, no second transition.

## Pass rules (2026-10-28)

The smoke now fails unless all three of these are true. A conversion alone is not a pass.

- Quote created.
- Conversion created or found `SETTLED` (or any non-`CANCELLED` status) under the stable `request_id`. A `CANCELLED` conversion is not counted, and the script does not create a replacement.
- Transfer proof is `CANCELLED` only. `FAILED`, `SENT`, and `PAID` are not a pass. The driver throws if the final status is anything else, including when an explicit `CANCELLED` transition comes back `FAILED`.

Beneficiary reuse is an exact nickname match on `two-key-smoke-supplier`. A list that does not contain that nickname is not reused, including the first row.

If a currency is under the 40 major-unit floor and `ensureCurrency` returns `blocked` or `short`, the script throws before the conversion lookup and before the transfer. A wallet that is already above the floor logs `sufficient (no deposit)` and does not call the deposit endpoint.

`AIRWALLEX_BASE_URL` must be `https://api.sandbox.airwallex.com` (or unset, which uses that origin). Any other host, including `https://api.airwallex.com`, throws `Sandbox only` before `createLiveClient`. A local run with the production host exited 1 and printed no login line.

### Rerun (2026-10-28)

`AIRWALLEX_MODE=live npm run live-smoke` exited 0. Host `https://api.sandbox.airwallex.com`.

| Step | Endpoint | Result |
|---|---|---|
| Login | `POST /api/v1/authentication/login` | 201 |
| Balances | `GET /api/v1/balances/current` | 200. EUR `9999990.99`, USD `10000010`. Same as after the 2026-10-27 payout refund. No deposit. |
| FX quote | `POST /api/v1/fx/quotes/create` | ok. `quote_id` `4fe65683-dd87-3ea0-94b7-2f3436f3d064`. EUR to USD, `client_rate` 1.105814, buy 10, sell 9.04, `valid_to` `2026-10-28T01:37:50+0000`. |
| Conversion | `GET /api/v1/fx/conversions?request_id=` | `already_done`. `32a3bfa6-0c1e-408b-986e-84a45f472449` `SETTLED`. No second create. |
| Transfer | `GET /api/v1/transfers?request_id=` | `already_done`. `4e1dab1a-c59b-413b-92d5-813f6caafd59` `CANCELLED`. No second create and no transition POST. Hops: `already CANCELLED`. |

Final line: `result pass quote=true conversion=true transfer=true`.

`npm run check` in mock mode: lint, typecheck, tests, leak-scan clean. The log from this rerun does not contain the client id, the API key, or a bearer token.

The 2026-11-05 receipt follow-up did not call the sandbox and did not change `scripts/live-smoke.ts`. The sandbox request ids in the tables above are historical. The mock desk now folds the buy amount into the FX request id and the transfer amount into the retry request id. A future sandbox run would be a new smoke, not a reuse of this note.

## Demo desk setup

The desk at `npm run dev` runs the mock $40k incident. It does not read the Airwallex client id or API key. It does not call a live Airwallex host.

Presence on the VM that wrote this note, names only:

| Name | Set |
|---|---|
| `OPENROUTER_API_KEY` | no |
| `OPENROUTER_MODEL_PLANNER` | no |
| `OPENROUTER_MODEL_WRINGER` | no |
| `AIRWALLEX_WEBHOOK_SECRET` | no |
| `CONVEX_URL` | no |
| `NEXT_PUBLIC_CONVEX_URL` | no |
| `TWO_KEY_INGEST_SECRET` | no |

With those unset, planner and Wringer use fixture responses, and the ledger stays in the Next process (`MemoryLedger`). `npm run demo` and `npm run check` do not need any of them.

To turn a piece on later, set the name as a Runtime Secret or in the server env. Do not commit the value.

- Live model: set `OPENROUTER_API_KEY`, `OPENROUTER_MODEL_PLANNER`, and `OPENROUTER_MODEL_WRINGER`. Leave `AGENT_MODE` unset. `AGENT_MODE=stub` keeps fixtures even if the key is present. The filed moves and the hard Wringer checks stay in code either way.
- Webhook ingest: set `AIRWALLEX_WEBHOOK_SECRET` on the route, and set `CONVEX_URL` plus `TWO_KEY_INGEST_SECRET` (same secret in the Convex deployment env) to store events in Convex. Missing either Convex value keeps the in-memory webhook store.
- Ledger claim and receipt sync: the same `CONVEX_URL` and `TWO_KEY_INGEST_SECRET` pair. `npx convex dev` must be run so the deployment matches `convex/schema.ts`. Until then the desk uses `MemoryLedger`, which is enough for `npm run check` and for one local `npm run dev` process. Every public function in `convex/ledger.ts`, including the webhook `timeline` read, checks that secret before touching the database. There is no anonymous Convex read of incidents or webhook payloads. The fixture desk stays available when Convex is unset.

Sandbox calls stay on `AIRWALLEX_MODE=live npm run live-smoke`, which refuses any base URL other than `https://api.sandbox.airwallex.com`. `createLiveClient` now refuses that host check itself, before login.

## Competitive slice (2026-11-05)

No sandbox write and no new account. `lib/airwallex/corridor.ts` returns `ran: false`. With the client id and API key unset it names those env vars and does not invent ids. The public fixture is `/fixture` and `GET /fixture/receipt`. It does not read Convex. A measured mock receipt is in `docs/shots/northwind-receipt.json`. Counts are in `docs/JUDGE.md`.
