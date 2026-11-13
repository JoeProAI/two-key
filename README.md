# Two-Key

A payment ops agent for the Airwallex Agentic Banking Hackathon. It fixes failed supplier payments without paying twice. Tracks: 03 Payment Ops Incident Commander (primary) and 01 Adaptive Treasury Controller.

Each money move needs two keys. The **planner** drafts the fix: retry the transfer, convert funds with an FX quote, or defer a low-priority payout. The **Wringer** tries to break the plan. It looks for duplicate or out-of-order webhooks, CANCELLED vs FAILED, stale FX quotes, and reserve breaches. After the bank rejects the payee name, it blocks any retry to the unchanged payee (`beneficiary_unchanged_after_mismatch`); the planner first updates the payee to the name the (fictional) supplier confirmed, with `POST /api/v1/beneficiaries/{id}/update`. The **executor** runs a plan only when both agree, uses one stable `request_id` per intent and action, and waits for a human tap at or above `APPROVAL_THRESHOLD_USD`. Every step lands in the ledger and comes out as a receipt.

Status: the $40k Northwind incident runs end to end in **MOCK** mode with no model key, no Convex deployment and no Airwallex keys. The desk opens on an image-led spread: the live amount, payee, state and next step beside an illustrative photo, then the bound rail (Incident, Cash plan, Independent check, Human authorization, Receipt). A **SANDBOX** smoke against `api.sandbox.airwallex.com` was run on 2026-10-27 (see `docs/ops-note.md`); `npm run proof` reruns it only when sandbox keys are present. Licensed MIT, see [LICENSE](LICENSE).

| Label | Means |
|---|---|
| MOCK | Hand-written fixtures in `lib/airwallex/mock.ts`. No network. No real money moves. The public desk and every `npm run demo` line are MOCK. |
| SANDBOX | Airwallex sandbox host only, real sandbox ids, still not real money. Only `npm run live-smoke` and the optional step in `npm run proof` call it. |
| Live money | Not built. The live client refuses any host other than `api.sandbox.airwallex.com`. |

## Airwallex sandbox evidence

Recorded sandbox run, 2026-10-27. The public desk runs the same corridor against a mock provider.

| Endpoint | Recorded result |
|---|---|
| `POST /api/v1/authentication/login` | 201 |
| `GET /api/v1/balances/current` | 200 |
| `POST /api/v1/fx/quotes/create` | quote `878e1b2c-070a-3b39-9b69-0a60291f9ec6` |
| `GET /api/v1/fx/conversions?request_id=` + `POST /api/v1/fx/conversions/create` | conversion `32a3bfa6-0c1e-408b-986e-84a45f472449` SETTLED |
| `GET /api/v1/transfers?request_id=` + `POST /api/v1/transfers/create` | transfer `4e1dab1a-c59b-413b-92d5-813f6caafd59` |
| `POST /api/v1/simulation/transfers/{id}/transition` | SENT, FAILED (`BENEFICIARY_NAME_MISMATCH`), read back CANCELLED |
| Rerun 2026-10-28 | `already_done` for both, no second create |

Those ids came from `scripts/live-smoke.ts`, not from this desk build. Details in `docs/ops-note.md`, the endpoint to code to test map in `docs/AIRWALLEX-MAP.md`. Rerun with your own sandbox keys: `AIRWALLEX_CLIENT_ID=... AIRWALLEX_API_KEY=... npm run proof`.

Skeptical? `docs/RED-TEAM.md` answers 20+ attacks with the test that proves each, and `docs/CLAIMS.md` maps every claim here to a command.

## Judges in 90 seconds

No keys. No site login. Node 20.9 or newer (tested on Node 22).

```bash
npm ci
npm run proof        # install check, npm run check, demo, demo -- rerun, matrix, optional SANDBOX corridor
npm run dev          # then open http://localhost:3000/fixture
```

`npm run proof` writes `artifacts/proof/summary.md` plus one log per step. It fails if the Northwind demo does not pay once, if the rerun is not `already_done` with zero new calls, or if any matrix row fails. Without `AIRWALLEX_CLIENT_ID` and `AIRWALLEX_API_KEY` the sandbox step prints `SANDBOX skipped` and names the missing variables. It never invents a sandbox id.

`/fixture` is the public judge page: MOCK, read only. The opening shows `INV-2291 Northwind Steel`, `40,000.00 USD`, the current state and the next step. The photo beside it is an illustrative scene, not transaction evidence. Open **Demo controls** to step through `incident`, `blocked`, `planned`, `refused`, `failed`, `paid` and `replay`. `docs/JUDGE.md` has the measured counts and `docs/shots/` has desktop and phone captures.

`npm run evidence` prints the failure matrix, then three separate scenarios: `main`, `replay`, and `deposit`. Provider ids change every process. Request ids stay, and they include the amount.

## Run it

```bash
npm install
cp .env.example .env.local     # AIRWALLEX_MODE=mock. Agents stay on fixtures until the OpenRouter key and both model names are set.
npm run demo                   # scripted $40k scenario, prints the receipt and writes the pack
npm run demo -- replay         # pay once, then a fresh process reconciles the same actions and the same provider ids
npm run demo -- rerun          # same as replay: the second run comes back already_done, no second send
npm run demo -- deposit       # a USD 18000 deposit after the block shrinks the FX buy from 28000 to 10000
npm run demo -- stale-quote    # 1-minute quote goes stale, Wringer blocks, planner re-quotes
npm run demo -- approval       # $25k payout waits 90 min for the tap, then pays once
npm run demo -- approval-timeout  # same payout, no tap within 4 hours: expires, nothing moves
npm run demo:agents            # planner + Wringer through OpenRouter (needs OPENROUTER_API_KEY and both model names, else exits 2). Transcript in artifacts/agent-runs/
npm run matrix                 # deterministic failure matrix, exits 1 on any fail
npm run check                  # lint + typecheck + tests + build-and-scan for leaked keys
npm run proof                  # one-command proof pack, writes artifacts/proof/ (add -- --skip-check for a quick pass)
npm run pack:source            # clean source zip from HEAD in dist/, prints the path, tree sha and sha256
AIRWALLEX_MODE=live npm run live-smoke   # SANDBOX host only. Not part of check. See docs/ops-note.md.
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
- `app/page.tsx` and `app/desk.tsx`: the desk. Failed transfer, planner rounds, Wringer objections, one approve, receipt. Mock Airwallex only. The pay button stays disabled until the latest round has no blocking objection.
- `app/ui/hero-plate.tsx` and `public/hero/`: the one illustrative photo, as AVIF and WebP with a JPEG fallback. Desktop uses the full frame; phones use a panoramic crop of the same master. `alt=""` because it carries no information the page needs.
- `scripts/proof.mjs`: `npm run proof`. `scripts/make-source-zip.sh`: `npm run pack:source`.

## Safety rules in code

- A `request_id` is `sha256` of the intent, the action, and the money fields (for FX: buy amount and both currencies; for a retry: slot, original transfer, amount, currency, and beneficiary). It does not depend on the attempt, a webhook, the quote id, or the clock. A different buy amount is a different id. The same id with a different payload is an error and does not send. Airwallex rejects a `request_id` reused within 7 days. Before creating a transfer, the executor looks it up with `GET /api/v1/transfers?request_id=`. Before creating a conversion, it looks it up with `GET /api/v1/fx/conversions?request_id=` ([list conversions](https://www.airwallex.com/docs/api/transactional_fx/conversion/list.md)). If the match is the same payload and is not CANCELLED, the action is `already_done`. If the match is CANCELLED the run stops for a human. A finished intent is reconciled from the saved actions. It is not replanned from the new balance. The live client also does this lookup when a create call errors.
- The executor re-reads the original transfer right before paying. It refuses to pay if the transfer isn't CANCELLED or FAILED.
- The LLM can add objections but can't remove the deterministic Wringer checks. A model objection whose `check` matches a hard check is dropped. A failed model call leaves the hard checks in place. The filed moves, amounts, and `request_id`s always come from code, including when the live path runs. Round 1 stays the fixture plan so the double-pay block still shows.
- Funding runs before paying (defer, then FX, then transfer). The run stops at the first error.
- A Convex execution row is finished only by the owner currently named on it. `ok` and `already_done` stay put, including the provider id. A replay adds a count. Lease expiry lets a second worker claim the row; the first worker's later `ok` or `error` does not replace it. The provider can still be in flight when a lease expires. Airwallex `request_id` lookup is the backstop, and this repo has not proved that window against a live host.
- Every public function in `convex/ledger.ts` checks `TWO_KEY_INGEST_SECRET` before it reads or writes. That includes `timeline`. The mock desk with no Convex deployment does not use those functions.
- A decision waiting on a human tap expires after 4 hours (`APPROVAL_TIMEOUT_MS` in fixtures). A tap after that is refused and the planner must start over.

## Desk

`npm run dev` serves the mock incident. `/fixture` is the public judge page: MOCK, read only, no desk key, no Convex read. Beats are `incident`, `blocked`, `planned`, `refused`, `failed`, `paid`, and `replay`. `blocked` stops on the round 1 objections and does not send. `refused` changes the cash snapshot and shows the existing evidence-digest refusal. It does not execute. `GET /fixture/receipt` returns the redacted JSON pack. `GET /fixture/receipt?format=csv` returns the execution rows.

The ops desk at `/` is the same story with the tap. When `DESK_APPROVE_SECRET` is unset and Convex is unset, anyone can run the local mock. When the key is set, plan, approve, replay, and the Convex incident need the cookie. A wrong key or a missing cookie stays on the fixture incident. The pay control stays off while the Wringer key is open.

The desk opens on one spread. On a desktop the photo sits left and the live summary right: payee reference, exact amount, state, the next step, and the plan round and digest the tap is bound to. On a phone the summary comes first, with the amount near the top of the screen, and a short panoramic crop of the same photo follows it. The photo is illustrative and is the same in every state. Its caption says it is not transaction evidence. Below it the rail reads Incident, Cash plan, Independent check, Human authorization, Receipt, then each section in that order. Demo controls stay collapsed. The MOCK label does not collapse.

The checker is a fixture program. A clear check is not consent. Every bound term the ledger actually stores is on the page before the mock approval button, and missing destination, fees, slippage, quote time, and authenticated identity stay marked unknown. Typing a name stores a demo label. It does not authenticate. The paid beat says a simulated payment was recorded. Replay checks the recorded ids and does not create a payment. The policy floor and the retainer are not reserved: USD 22,000 + 28,000 − 40,000 = 10,000, which is the floor. A failed simulation does not get a paid receipt. A tap is refused if the cash evidence changed after the plan was filed. If the shared ledger keeps another worker's row, this desk does not claim that provider call was undone.

The desk does not call the live Airwallex host. The live client refuses any host other than `api.sandbox.airwallex.com`. `lib/airwallex/corridor.ts` describes the sandbox steps and does not send. Missing credential names come back from that status check. No id is invented.

The planner is filed before a tap exists. Wringer blocks the tap while the latest round has an objection. Selecting a step does not call a provider. The public fixture is read only. The private desk is the page with the tap.

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

Convex is optional and is not configured for this build. No Convex deployment, `CONVEX_URL`, `TWO_KEY_INGEST_SECRET` or `DESK_APPROVE_SECRET` is set on the hosted demo. `npx convex dev` has not been run from this branch. After it is, point the server at that deployment. The schema in `convex/schema.ts` is the one to push. `npm run check` and `npm run demo` stay green with all of the above unset.

The desk's no-double-pay guarantee across a process restart needs the Convex claim. Inside one `npm run dev` process, the mock client and `MemoryLedger` already refuse a second send, and Replay shows `already_done`.

## Before submission (Joe)

1. Review and merge the submit PR. Optionally promote a production deploy. The hosted desk stays `AIRWALLEX_MODE=mock`.
2. Make the repo public when ready. It stays private until then.
3. Optional SANDBOX rerun: put `AIRWALLEX_CLIENT_ID` and `AIRWALLEX_API_KEY` in `.env.local` or the shell, then `npm run proof`. Never paste them in chat or commit them.
4. Optional durable ledger: run `npx convex dev`, set `CONVEX_URL` and `TWO_KEY_INGEST_SECRET` (same value in the Convex env), and set `DESK_APPROVE_SECRET`. `MemoryLedger` stays the path when either Convex value is missing.
5. Record the video from `docs/demo-script.md`, run `npm run pack:source` for the upload archive, and submit before Fri Nov 13, 1:29 PM ET.

Still open from the sandbox plan: subscribe `POST /api/v1/webhooks/create` for `payout.transfer.*` and confirm `payout.transfer.cancelled` delivery on the auto-cancel path.

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

MIT. See [LICENSE](LICENSE).
