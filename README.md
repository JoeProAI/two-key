# Two-Key

A payment ops agent for the Airwallex Agentic Banking Hackathon. It fixes failed supplier payments without paying twice. Tracks: 03 Payment Ops Incident Commander (primary) and 01 Adaptive Treasury Controller.

Each money move needs two keys. The **planner** drafts the fix: retry the transfer, convert funds with an FX quote, or defer a low-priority payout. The **Wringer** tries to break the plan. It looks for duplicate or out-of-order webhooks, CANCELLED vs FAILED, stale FX quotes, and reserve breaches. The **executor** runs a plan only when both agree, uses one stable `request_id` per intent and action, and waits for a human tap at or above `APPROVAL_THRESHOLD_USD`. Every step lands in the ledger and comes out as a receipt.

Status: day-one skeleton, built Oct 11, 2026 before acceptance. Mock mode runs end to end with no keys. Live mode is written against the docs but hasn't been run, because there's no sandbox account yet.

## Run it

```bash
npm install --legacy-peer-deps
cp .env.example .env.local     # defaults: AIRWALLEX_MODE=mock, AGENT_MODE=stub
npm run demo                   # scripted $40k scenario, prints the receipt
npm run check                  # lint + typecheck + tests + build-and-scan for leaked keys
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

Never give a secret a `NEXT_PUBLIC_` prefix. `tests/key-leak.test.ts` and `scripts/leak-scan.mjs` fail the check if a key name or value reaches client code or build output.

## Layout

- `lib/airwallex/`: `live.ts` (the only file that touches keys, server-only, with token refresh), `mock.ts` plus `fixtures.ts` (hand-written), and `types.ts` (field names from the API reference)
- `lib/agents/`: `planner.ts`, `wringer.ts`, `executor.ts`, and `openrouter.ts`
- `lib/webhooks/`: `verify.ts` (HMAC) and `inbox.ts` (dedupe by event id, order by `created_at`)
- `lib/scenario.ts`: the scripted demo, plus `scripts/demo.ts`
- `convex/schema.ts`: tables for intents, proposals, objections, decisions, executions, webhookEvents and receipts. `convex/ledger.ts` holds the webhook ingest and execution-claim functions
- `app/api/webhooks/airwallex/route.ts`: the webhook receiver
- `docs/frontend-design-SKILL.md`: Joe's Frontend Design skill, copied byte for byte

## Safety rules in code

- A `request_id` is `sha256(intent, action)`, so it never depends on the attempt, a webhook or the clock. Airwallex rejects a `request_id` reused within 7 days. Before creating a transfer, the executor also looks it up with `GET /api/v1/transfers?request_id=`.
- The executor re-reads the original transfer right before paying. It refuses to pay if the transfer isn't CANCELLED or FAILED.
- The LLM can add objections but can't remove the deterministic Wringer checks. It also can't set ids, amounts or request_ids.
- Funding runs before paying (defer, then FX, then transfer). The run stops at the first error.

## UI pass (not started)

The UI pass must follow `/home/box/agent-data/workflows/frontend-design/SKILL.md` verbatim. A byte-for-byte copy is at `docs/frontend-design-SKILL.md` (md5 `2e2d013e78b20574515d7de292e14b1d`). Pass that file to the builder as written. Don't summarize it, condense it, or add other style rules on top. Right now `app/page.tsx` is a bare placeholder.

## TODO after acceptance (around Oct 25)

1. **Joe:** sign up for the Airwallex sandbox at sandbox.airwallex.com with a work email. Create a scoped API key.
2. **Joe:** add `AIRWALLEX_CLIENT_ID`, `AIRWALLEX_API_KEY`, `AIRWALLEX_WEBHOOK_SECRET` and `OPENROUTER_API_KEY` as Runtime Secrets in the Cursor Cloud Agents environment for this repo. Never paste them in chat.
3. Run `npx convex dev`, switch `convex/ledger.ts` to `./_generated/server`, and move the webhook route and executor from the in-memory ledger to Convex.
4. Run a live sandbox smoke test: login, balances, quote, and conversion. Then create a transfer and drive it with `POST /api/v1/simulation/transfers/{id}/transition` (`FAILED` with `failure_type`, then `CANCELLED`).
5. Fund the sandbox with the deposit simulation (check the exact endpoint under Simulation > Deposits). Create the supplier beneficiary.
6. Subscribe to the webhook with `POST /api/v1/webhooks/create` for `payout.transfer.*` events. Point it at a public URL.
7. Check the open questions below against the live sandbox.
8. Add an FX conversion lookup by `request_id` before re-sending, like the one transfers already have.
9. Do the UI pass from the skill file, record a demo video under 5 minutes, make the repo public (HackerEarth wants open source), and build the tar or zip.
10. **Joe:** review by Nov 11 and submit before Fri Nov 13, 1:29 PM ET.

## Open questions

- What does a duplicate `request_id` error look like on `/transfers/create` and `/fx/conversions/create` (status and code)? The mock uses 400 `duplicate_request`.
- Does the list-transfers response wrap results as `{ items: [...] }`? The client assumes it does.
- Is the conversion response id field `conversion_id` (assumed), and what are its status values?
- Does `payout.transfer.cancelled` fire after the auto-cancel of a FAILED transfer? The demo assumes it does.
- What is the minimum headroom on a quote before converting? 60 seconds is assumed.
- Judging criteria aren't published yet.

## License

MIT
