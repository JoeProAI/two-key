# Two-Key

A payment ops agent for the Airwallex Agentic Banking Hackathon. It fixes failed supplier payments without paying twice. Tracks: 03 Payment Ops Incident Commander (primary) and 01 Adaptive Treasury Controller.

Each money move needs two keys. The **planner** drafts the fix: retry the transfer, convert funds with an FX quote, or defer a low-priority payout. The **Wringer** tries to break the plan. It looks for duplicate or out-of-order webhooks, CANCELLED vs FAILED, stale FX quotes, and reserve breaches. The **executor** runs a plan only when both agree, uses one stable `request_id` per intent and action, and waits for a human tap at or above `APPROVAL_THRESHOLD_USD`. Every step lands in the ledger and comes out as a receipt.

Status: mock $40k desk runs with no model key and no Convex deployment. Live sandbox smoke has been run (see `docs/ops-note.md`). This competitive slice did not call the sandbox. The repo stays private.

## Judges in 90 seconds

No keys. No site login. The public fixture is also at `/fixture` when the app is running, and it never reads a private incident.

```bash
npm ci && npm run check && npm run demo && npm run demo -- rerun
```

`npm run evidence` prints the failure matrix, then the same two demos, and writes `artifacts/receipts/northwind-latest.json` plus a CSV of executions. `docs/JUDGE.md` has the measured counts. Provider ids change every process. Request ids do not.

## Run it

```bash
npm install
cp .env.example .env.local     # AIRWALLEX_MODE=mock. Agents stay on fixtures until the OpenRouter key and both model names are set.
npm run demo                   # scripted $40k scenario, prints the receipt and writes the pack
npm run demo -- rerun          # same account, second run, empty ledger; sends nothing new
npm run demo -- deposit       # a USD 18000 deposit after the block shrinks the FX buy from 28000 to 10000
npm run demo -- stale-quote    # 1-minute quote goes stale, Wringer blocks, planner re-quotes
npm run demo -- approval       # $25k payout waits 90 min for the tap, then pays once
npm run demo -- approval-timeout  # same payout, no tap within 4 hours: expires, nothing moves
npm run matrix                 # deterministic failure matrix, exits 1 on any fail
npm run check                  # lint + typecheck + tests + build-and-scan for leaked keys
AIRWALLEX_MODE=live npm run live-smoke   # sandbox host only. Not part of check. See docs/ops-note.md.
npm run dev                    # desk. /fixture is the public mock. The ops desk stays locked when DESK_APPROVE_SECRET is set.
```

## Env vars

| Var | Where | Purpose |
|---|---|---|
| `AIRWALLEX_MODE` | server | `mock` (fixtures, default) or `live` (sandbox) |
| `AIRWALLEX_CLIENT_ID`, `AIRWALLEX_API_KEY` | server, Runtime Secret | Read only in `lib/airwallex/live.ts` |
| `AIRWALLEX_BASE_URL` | server | Default `https://api.sandbox.airwallex.com` |
| `AIRWALLEX_LOGIN_AS` | server | Optional `x-login-as` account id |
| `AIRWALLEX_WEBHOOK_SECRET` | server, Runtime Secret | Secret for the notification URL |
| `AGENT_MODE` | server | `stub` forces fixture plans and objections even if the OpenRouter key is set. Leave it unset to allow the live path. |
| `OPENROUTER_API_KEY` | server, Runtime Secret | Required for a live model call. If it is unset, planner and Wringer stay on fixtures and no model request is sent. |
| `OPENROUTER_MODEL_PLANNER`, `OPENROUTER_MODEL_WRINGER` | server | Both required for the live path. No model id is hardcoded. If either is unset, fixtures are used. |
| `APPROVAL_THRESHOLD_USD` | server | Human tap at or above this amount (default 10000) |
| `NEXT_PUBLIC_CONVEX_URL` | client | Written by `npx convex dev` |
| `CONVEX_URL` | server | Convex deployment URL for the webhook route (falls back to `NEXT_PUBLIC_CONVEX_URL`) |
| `TWO_KEY_INGEST_SECRET` | server and Convex env, Runtime Secret | Guards every public ledger function (`ingestWebhook`, `timeline`, `upsertIncident`, `claimExecutionPublic`, `finishExecution`, `getIncident`). Unset means webhooks and the desk stay on the in-memory store. |
| `DESK_APPROVE_SECRET` | server, Runtime Secret | Desk key. When set, plan, approve, replay and the Convex ledger view need it. The desk asks for it once and keeps an httpOnly cookie (an HMAC of the key, not the key). Required when Convex is configured: without it the shared desk stays closed. Unset with no Convex means the public fixture demo. |

Never give a secret a `NEXT_PUBLIC_` prefix. `tests/key-leak.test.ts` and `scripts/leak-scan.mjs` fail the check if a key name or value reaches client code or build output.

## Layout

- `lib/airwallex/`: `live.ts` (the only file that touches keys, server-only, with token refresh), `mock.ts` plus `fixtures.ts` (hand-written), and `types.ts` (field names from the API reference)
- `lib/agents/`: `planner.ts`, `wringer.ts`, `executor.ts`, and `openrouter.ts`
- `lib/webhooks/`: `verify.ts` (HMAC), `inbox.ts` (dedupe by event id, order by `created_at`), and `store.ts` (the `WebhookStore` interface with a memory adapter and a Convex adapter)
- `lib/scenario.ts`: the main $40k demo. `lib/scenarios.ts`: the other demo scenarios and the name table `scripts/demo.ts` reads. `lib/desk/session.ts`: the same demo behind the desk UI
- `lib/ledger/remote.ts`: writes that demo into Convex when `CONVEX_URL` (or `NEXT_PUBLIC_CONVEX_URL`) and `TWO_KEY_INGEST_SECRET` are both set. Otherwise `MemoryLedger` is the whole store. The executor also claims `request_id` there before it pays.
- `docs/demo-script.md`: beat sheet for the video
- `convex/schema.ts`: tables for intents, proposals, objections, decisions, executions, webhookEvents and receipts. App ids are strings (`key`, `intentKey`). `convex/ledger.ts` holds webhook ingest, incident upsert, execution claim, and the incident read. All public functions check `TWO_KEY_INGEST_SECRET`.
- `app/api/webhooks/airwallex/route.ts`: the webhook receiver. Writes through `WebhookStore`; returns 503 if the store is down so Airwallex retries
- `app/page.tsx`: the desk. Failed transfer, planner rounds, Wringer objections, one approve, receipt. Mock Airwallex only. The pay button stays disabled until the latest round has no blocking objection.
- `docs/frontend-design-SKILL.md`: Joe's Frontend Design skill, copied byte for byte

## Safety rules in code

- A `request_id` is `sha256(intent, action)`, so it never depends on the attempt, a webhook or the clock. Airwallex rejects a `request_id` reused within 7 days. Before creating a transfer, the executor also looks it up with `GET /api/v1/transfers?request_id=`. Before creating a conversion, it looks it up with `GET /api/v1/fx/conversions?request_id=` ([list conversions](https://www.airwallex.com/docs/api/transactional_fx/conversion/list.md)). If a match exists the action is `already_done`; if the match is CANCELLED the run stops for a human. The live client also does this lookup when a create call errors.
- The executor re-reads the original transfer right before paying. It refuses to pay if the transfer isn't CANCELLED or FAILED.
- The LLM can add objections but can't remove the deterministic Wringer checks. A model objection whose `check` matches a hard check is dropped. A failed model call leaves the hard checks in place. The filed moves, amounts, and `request_id`s always come from code, including when the live path runs. Round 1 stays the fixture plan so the double-pay block still shows.
- Funding runs before paying (defer, then FX, then transfer). The run stops at the first error.
- A Convex execution row is finished only by the owner currently named on it. `ok` and `already_done` stay put, including the provider id. A replay adds a count. Lease expiry lets a second worker claim the row; the first worker's later `ok` or `error` does not replace it. The provider can still be in flight when a lease expires. Airwallex `request_id` lookup is the backstop, and this repo has not proved that window against a live host.
- Every public function in `convex/ledger.ts` checks `TWO_KEY_INGEST_SECRET` before it reads or writes. That includes `timeline`. The mock desk with no Convex deployment does not use those functions.
- A decision waiting on a human tap expires after 4 hours (`APPROVAL_TIMEOUT_MS` in fixtures). A tap after that is refused and the planner must start over.

## Desk

`npm run dev` serves the mock incident. `/fixture` is the public judge page: MOCK FIXTURE, read only, no desk key, no Convex read. Beats are `incident`, `planned`, `failed`, `paid`, and `replay`. `GET /fixture/receipt` returns the redacted JSON pack. `GET /fixture/receipt?format=csv` returns the execution rows.

The ops desk at `/` is the same story with the tap. When `DESK_APPROVE_SECRET` is unset and Convex is unset, anyone can run the local mock. When the key is set, plan, approve, replay, and the Convex incident need the cookie. A wrong key or a missing cookie stays on the fixture incident. The pay control stays off while the Wringer key is open.

The spine on the sheet is the receipt: request, cash, plan, Wringer, approval, execution, balances, replay. Each station links to that evidence. A failed send does not get a paid receipt. A tap is refused if the cash evidence changed after the plan was filed. If the shared ledger keeps another worker's row, this desk does not claim that provider call was undone.

The desk does not call the live Airwallex host. The live client refuses any host other than `api.sandbox.airwallex.com`. `lib/airwallex/corridor.ts` describes the sandbox steps and does not send. Missing credential names come back from that status check. No id is invented.

The UI follows `docs/frontend-design-SKILL.md`. The two-key rail is the control: the planner key seats when a plan is filed, the Wringer key seats only when the latest round has no block, and the tap stays disabled until both are seated.

## What is still unset for a live demo

Checked as names only. Do not paste values into the repo, the desk, or chat.

| Name | Needed for | If unset |
|---|---|---|
| `OPENROUTER_API_KEY` | Live planner comment and extra Wringer objections | Fixture responses. No model request. |
| `OPENROUTER_MODEL_PLANNER`, `OPENROUTER_MODEL_WRINGER` | Same live path. Set both. | Fixture responses, even if the key is set. |
| `AGENT_MODE=stub` | Forces fixtures | Leave unset if you want the live path once the three values above exist. |
| `AIRWALLEX_WEBHOOK_SECRET` | `POST /api/webhooks/airwallex` signature check | The route returns 500. The mock desk does not need it. |
| `CONVEX_URL` or `NEXT_PUBLIC_CONVEX_URL` | Convex webhook store, incident upsert, and the execution claim | `MemoryWebhookStore` and `MemoryLedger`. |
| `TWO_KEY_INGEST_SECRET` | Same Convex path. Set the same value in the Convex deployment env and the Next server env. | In-memory store, even if a Convex URL is set. |
| `DESK_APPROVE_SECRET` | Who may plan, approve, replay, and read the Convex incident on the desk | Public fixture desk. With Convex configured, the desk stays closed. |

`npx convex dev` has not been run from this slice. After it is, point the server at that deployment. The schema in `convex/schema.ts` is the one to push. `npm run check` and `npm run demo` stay green with all of the above unset.

The desk's no-double-pay guarantee across a process restart needs the Convex claim. Inside one `npm run dev` process, the mock client and `MemoryLedger` already refuse a second send, and Replay shows `already_done`.

## TODO after acceptance (around Oct 25)

1. **Joe:** sign up for the Airwallex sandbox at sandbox.airwallex.com with a work email. Create a scoped API key.
2. **Joe:** add `AIRWALLEX_CLIENT_ID`, `AIRWALLEX_API_KEY`, `AIRWALLEX_WEBHOOK_SECRET` and `OPENROUTER_API_KEY` as Runtime Secrets in the Cursor Cloud Agents environment for this repo. Never paste them in chat.
3. Run `npx convex dev` so the deployment matches `convex/schema.ts`, switch `convex/ledger.ts` to `./_generated/server` if you want generated types, set `TWO_KEY_INGEST_SECRET` in both the Convex env and the Next server env, and set `CONVEX_URL`. Webhooks, incident upsert, and the execution claim already use that pair. `MemoryLedger` remains the local path when either value is missing.
4. Run a live sandbox smoke test: login, balances, quote, and conversion. Then create a transfer and drive it with `POST /api/v1/simulation/transfers/{id}/transition` (`FAILED` with `failure_type`, then `CANCELLED`).
5. Fund the sandbox with the deposit simulation (check the exact endpoint under Simulation > Deposits). Create the supplier beneficiary.
6. Subscribe to the webhook with `POST /api/v1/webhooks/create` for `payout.transfer.*` events. Point it at a public URL.
7. Check the open questions below against the live sandbox.
8. Done Oct 13: FX conversion lookup by `request_id` before re-sending. Check it against the sandbox in step 4.
9. The mock desk is in. Still open: a demo video under 5 minutes, making the repo public when Joe says so (it stays private until then), and the tar or zip.
10. **Joe:** review by Nov 11 and submit before Fri Nov 13, 1:29 PM ET.

## Open questions

Answered from the Airwallex docs (checked Oct 13, 2026). Mocks now match these.

- **Duplicate `request_id` on `/transfers/create`:** 400 with code `request_id_duplicate`. A create still in flight returns 409 `request_pending`. Error bodies are `{ code, source, message, details }`. Sources: [Create a transfer, Errors](https://www.airwallex.com/docs/api/payouts/transfers/create.md), [Errors](https://www.airwallex.com/docs/api/errors.md).
- **List wrapper:** yes. `GET /api/v1/transfers` returns `{ items, page_after, page_before }` and `GET /api/v1/fx/conversions` returns `{ has_more, items }`. Both accept a `request_id` filter. Sources: [List transfers](https://www.airwallex.com/docs/api/payouts/transfers/list.md), [List conversions](https://www.airwallex.com/docs/api/transactional_fx/conversion/list.md).
- **Conversion id and statuses:** the id field is `conversion_id` (uuid). Status is one of `SCHEDULED`, `OVERDUE`, `CANCELLED`, `SETTLED`. Retrieve is `GET /api/v1/fx/conversions/{conversion_id}`. Sources: [Retrieve a conversion](https://www.airwallex.com/docs/api/transactional_fx/conversion/retrieve.md), list page above.
- **Expired quote codes differ by endpoint:** `/fx/conversions/create` uses `expired_quote`, `/transfers/create` uses `quote_expired`. Insufficient balance on transfers is `balance_insufficient`.

Still open:

- **Duplicate `request_id` on `/fx/conversions/create`:** the docs only say such requests "will be rejected". The listed 400 codes (`invalid_argument`, `operation_failed`, ...) include no dedicated one. The mock uses 400 `request_id_duplicate` to mirror transfers. The executor does not depend on the code, because it looks the request_id up before creating and after any create error.
- **Does `payout.transfer.cancelled` fire after the auto-cancel of a FAILED transfer?** The docs say failed transfers "will be automatically cancelled in seconds" and map CANCELLED to `payout.transfer.cancelled` ([Transfer statuses](https://www.airwallex.com/docs/payouts/transfers/create-a-transfer/transfer-statuses.md)), but never say outright that the event fires on the automatic path. The demo assumes it does. The executor re-reads the transfer with GET before paying, so a missing event can't cause a double payment. Sandbox smoke on 2026-10-27: `POST /api/v1/simulation/transfers/{id}/transition` with `FAILED` returned `failure_reason` `90301: Beneficiary name mismatch`, and the immediate GET was already `CANCELLED`. No webhook subscription was created, so delivery of `payout.transfer.cancelled` is still unconfirmed. See `docs/ops-note.md`.
- **Minimum headroom on a quote before converting:** not in the docs. 60 seconds is assumed.
- **Approval timeout length:** 4 hours is a product choice, not an Airwallex rule. Joe should pick the real number.
- **Judging criteria** aren't published yet.

## License

MIT
