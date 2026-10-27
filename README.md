# Two-Key

A payment ops agent for the Airwallex Agentic Banking Hackathon. It fixes failed supplier payments without paying twice. Tracks: 03 Payment Ops Incident Commander (primary) and 01 Adaptive Treasury Controller.

Each money move needs two keys. The **planner** drafts the fix: retry the transfer, convert funds with an FX quote, or defer a low-priority payout. The **Wringer** tries to break the plan. It looks for duplicate or out-of-order webhooks, CANCELLED vs FAILED, stale FX quotes, and reserve breaches. The **executor** runs a plan only when both agree, uses one stable `request_id` per intent and action, and waits for a human tap at or above `APPROVAL_THRESHOLD_USD`. Every step lands in the ledger and comes out as a receipt.

Status: day-one skeleton, built Oct 11, 2026 before acceptance. Mock mode runs end to end with no keys. Live mode is written against the docs but hasn't been run, because there's no sandbox account yet.

## Run it

```bash
npm install --legacy-peer-deps
cp .env.example .env.local     # defaults: AIRWALLEX_MODE=mock, AGENT_MODE=stub
npm run demo                   # scripted $40k scenario, prints the receipt
npm run demo -- rerun          # same, run twice; second run has an empty ledger and sends nothing new
npm run demo -- stale-quote    # 1-minute quote goes stale, Wringer blocks, planner re-quotes
npm run demo -- approval       # $25k payout waits 90 min for the tap, then pays once
npm run demo -- approval-timeout  # same payout, no tap within 4 hours: expires, nothing moves
npm run check                  # lint + typecheck + tests + build-and-scan for leaked keys
AIRWALLEX_MODE=live npm run live-smoke   # sandbox only: login, balances, FX quote, then a small conversion and a transfer driven FAILED then CANCELLED. Not part of check. See docs/ops-note.md.
npm run dev                    # bare placeholder page + webhook route
```

## Env vars

| Var | Where | Purpose |
|---|---|---|
| `AIRWALLEX_MODE` | server | `mock` (fixtures, default) or `live` (sandbox) |
| `AIRWALLEX_CLIENT_ID`, `AIRWALLEX_API_KEY` | server, Runtime Secret | Read only in `lib/airwallex/live.ts` |
| `AIRWALLEX_BASE_URL` | server | Default `https://api.sandbox.airwallex.com` |
| `AIRWALLEX_LOGIN_AS` | server | Optional `x-login-as` account id |
| `AIRWALLEX_WEBHOOK_SECRET` | server, Runtime Secret | Secret for the notification URL |
| `AGENT_MODE` | server | `stub` (deterministic, default) or `llm` |
| `OPENROUTER_API_KEY` | server, Runtime Secret | All model calls go through OpenRouter |
| `OPENROUTER_MODEL_PLANNER`, `OPENROUTER_MODEL_WRINGER` | server | Model per agent. Nothing is hardcoded |
| `APPROVAL_THRESHOLD_USD` | server | Human tap at or above this amount (default 10000) |
| `NEXT_PUBLIC_CONVEX_URL` | client | Written by `npx convex dev` |
| `CONVEX_URL` | server | Convex deployment URL for the webhook route (falls back to `NEXT_PUBLIC_CONVEX_URL`) |
| `TWO_KEY_INGEST_SECRET` | server and Convex env, Runtime Secret | Guards the public `ledger:ingestWebhook` mutation. Unset means the route uses the in-memory store |

Never give a secret a `NEXT_PUBLIC_` prefix. `tests/key-leak.test.ts` and `scripts/leak-scan.mjs` fail the check if a key name or value reaches client code or build output.

## Layout

- `lib/airwallex/`: `live.ts` (the only file that touches keys, server-only, with token refresh), `mock.ts` plus `fixtures.ts` (hand-written), and `types.ts` (field names from the API reference)
- `lib/agents/`: `planner.ts`, `wringer.ts`, `executor.ts`, and `openrouter.ts`
- `lib/webhooks/`: `verify.ts` (HMAC), `inbox.ts` (dedupe by event id, order by `created_at`), and `store.ts` (the `WebhookStore` interface with a memory adapter and a Convex adapter)
- `lib/scenario.ts`: the main $40k demo. `lib/scenarios.ts`: the other demo scenarios and the name table `scripts/demo.ts` reads
- `docs/demo-script.md`: beat sheet for the video
- `convex/schema.ts`: tables for intents, proposals, objections, decisions, executions, webhookEvents and receipts. `convex/ledger.ts` holds the webhook ingest (public, secret-guarded, plus an internal twin) and execution-claim functions
- `app/api/webhooks/airwallex/route.ts`: the webhook receiver. Writes through `WebhookStore`; returns 503 if the store is down so Airwallex retries
- `docs/frontend-design-SKILL.md`: Joe's Frontend Design skill, copied byte for byte

## Safety rules in code

- A `request_id` is `sha256(intent, action)`, so it never depends on the attempt, a webhook or the clock. Airwallex rejects a `request_id` reused within 7 days. Before creating a transfer, the executor also looks it up with `GET /api/v1/transfers?request_id=`. Before creating a conversion, it looks it up with `GET /api/v1/fx/conversions?request_id=` ([list conversions](https://www.airwallex.com/docs/api/transactional_fx/conversion/list.md)). If a match exists the action is `already_done`; if the match is CANCELLED the run stops for a human. The live client also does this lookup when a create call errors.
- The executor re-reads the original transfer right before paying. It refuses to pay if the transfer isn't CANCELLED or FAILED.
- The LLM can add objections but can't remove the deterministic Wringer checks. It also can't set ids, amounts or request_ids.
- Funding runs before paying (defer, then FX, then transfer). The run stops at the first error.
- A decision waiting on a human tap expires after 4 hours (`APPROVAL_TIMEOUT_MS` in fixtures). A tap after that is refused and the planner must start over.

## UI pass (not started)

The UI pass must follow `/home/box/agent-data/workflows/frontend-design/SKILL.md` verbatim. A byte-for-byte copy is at `docs/frontend-design-SKILL.md` (md5 `2e2d013e78b20574515d7de292e14b1d`). Pass that file to the builder as written. Don't summarize it, condense it, or add other style rules on top. Right now `app/page.tsx` is a bare placeholder.

## TODO after acceptance (around Oct 25)

1. **Joe:** sign up for the Airwallex sandbox at sandbox.airwallex.com with a work email. Create a scoped API key.
2. **Joe:** add `AIRWALLEX_CLIENT_ID`, `AIRWALLEX_API_KEY`, `AIRWALLEX_WEBHOOK_SECRET` and `OPENROUTER_API_KEY` as Runtime Secrets in the Cursor Cloud Agents environment for this repo. Never paste them in chat.
3. Run `npx convex dev`, switch `convex/ledger.ts` to `./_generated/server`, set `TWO_KEY_INGEST_SECRET` in both the Convex env and the Next server env, and set `CONVEX_URL`. The webhook route already writes through `ConvexWebhookStore` once those are set. The executor and ledger still use `MemoryLedger`; move them to Convex next.
4. Run a live sandbox smoke test: login, balances, quote, and conversion. Then create a transfer and drive it with `POST /api/v1/simulation/transfers/{id}/transition` (`FAILED` with `failure_type`, then `CANCELLED`).
5. Fund the sandbox with the deposit simulation (check the exact endpoint under Simulation > Deposits). Create the supplier beneficiary.
6. Subscribe to the webhook with `POST /api/v1/webhooks/create` for `payout.transfer.*` events. Point it at a public URL.
7. Check the open questions below against the live sandbox.
8. Done Oct 13: FX conversion lookup by `request_id` before re-sending. Check it against the sandbox in step 4.
9. Do the UI pass from the skill file, record a demo video under 5 minutes, make the repo public (HackerEarth wants open source), and build the tar or zip.
10. **Joe:** review by Nov 11 and submit before Fri Nov 13, 1:29 PM ET.

## Open questions

Answered from the Airwallex docs (checked Oct 13, 2026). Mocks now match these.

- **Duplicate `request_id` on `/transfers/create`:** 400 with code `request_id_duplicate`. A create still in flight returns 409 `request_pending`. Error bodies are `{ code, source, message, details }`. Sources: [Create a transfer, Errors](https://www.airwallex.com/docs/api/payouts/transfers/create.md), [Errors](https://www.airwallex.com/docs/api/errors.md).
- **List wrapper:** yes. `GET /api/v1/transfers` returns `{ items, page_after, page_before }` and `GET /api/v1/fx/conversions` returns `{ has_more, items }`. Both accept a `request_id` filter. Sources: [List transfers](https://www.airwallex.com/docs/api/payouts/transfers/list.md), [List conversions](https://www.airwallex.com/docs/api/transactional_fx/conversion/list.md).
- **Conversion id and statuses:** the id field is `conversion_id` (uuid). Status is one of `SCHEDULED`, `OVERDUE`, `CANCELLED`, `SETTLED`. Retrieve is `GET /api/v1/fx/conversions/{conversion_id}`. Sources: [Retrieve a conversion](https://www.airwallex.com/docs/api/transactional_fx/conversion/retrieve.md), list page above.
- **Expired quote codes differ by endpoint:** `/fx/conversions/create` uses `expired_quote`, `/transfers/create` uses `quote_expired`. Insufficient balance on transfers is `balance_insufficient`.

Still open:

- **Duplicate `request_id` on `/fx/conversions/create`:** the docs only say such requests "will be rejected". The listed 400 codes (`invalid_argument`, `operation_failed`, ...) include no dedicated one. The mock uses 400 `request_id_duplicate` to mirror transfers. The executor does not depend on the code, because it looks the request_id up before creating and after any create error.
- **Does `payout.transfer.cancelled` fire after the auto-cancel of a FAILED transfer?** The docs say failed transfers "will be automatically cancelled in seconds" and map CANCELLED to `payout.transfer.cancelled` ([Transfer statuses](https://www.airwallex.com/docs/payouts/transfers/create-a-transfer/transfer-statuses.md)), but never say outright that the event fires on the automatic path. The demo assumes it does. The executor re-reads the transfer with GET before paying, so a missing event can't cause a double payment. Confirm in the sandbox.
- **Minimum headroom on a quote before converting:** not in the docs. 60 seconds is assumed.
- **Approval timeout length:** 4 hours is a product choice, not an Airwallex rule. Joe should pick the real number.
- **Judging criteria** aren't published yet.

## License

MIT
