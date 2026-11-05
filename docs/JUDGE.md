# Judges

Measured on 2026-11-05 from this working tree, mock mode, no model key, no Convex, no Airwallex call.

`npm run check`: lint, typecheck, 109 tests, leak-scan clean (45 client files, 12 needles), Next.js 15.5.27 build.

## 90 seconds

```bash
npm ci && npm run check && npm run demo && npm run demo -- rerun
```

`npm run evidence` prints the matrix and both demos. It writes `artifacts/receipts/northwind-latest.json` and a CSV beside it. A sample of one mock run is in `docs/shots/northwind-receipt.json`. Provider ids in that file are from that process. The next run mints new provider ids. These request ids stay:

| Move | request_id |
|---|---|
| FX conversion | `cbed6cc7-350b-67aa-89c9-744f995ff038` |
| Retry transfer | `7ff012e1-94ad-76e3-0ebc-d5b0221e876e` |

## What `npm run demo` printed

Mode line: `MOCK FIXTURE`.

Round 1 blocks: `double_payment`, `unstable_request_id`, `reserve_breach`. Notes: `duplicate_webhook` (`evt_failed_01` x2, counted once) and `out_of_order_webhook` (arrival PROCESSING, created_at CANCELLED).

Round 2: one stable retry, buy 28000 USD with EUR, defer the 7000 retainer. Decision `approved, approved by joe`.

Executions: defer ok, FX ok, retry ok.

Balances after, available: USD 10000, EUR 34074.07.

Counters: transfers created 1, conversions 1, quotes 1.

## What `npm run demo -- rerun` printed

Same process, second plan, empty ledger. The first pay had already left USD at 10000, so the second plan's quote is buy 40000 USD. The stable request ids come back `already_done`. Counters stay transfers 1, conversions 1. Quotes become 2 because the second plan asks for a new quote and does not create a second conversion.

## Matrix

`npm run matrix` on the same day: 16 pass, 0 fail.

| Case | Measured |
|---|---|
| duplicate webhook | unique failures 1, `evt_failed_01` deliveries 2 |
| out-of-order webhook | created_at CANCELLED, arrival PROCESSING |
| FAILED then CANCELLED | transfers 1, conversions 1, stable retry ok |
| stale FX quote | round 1 blocked, conversions 1 |
| reserve breach | blocked, transfers 0 |
| claim lease busy | second worker busy, transfers 0 |
| replay after success | replays 1, same provider id, transfers 1 |
| approve without desk key | rejected, transfers 0 |
| failed provider send | FX error, transfers 0, balances unchanged, no paid receipt |
| approval timeout | expired, transfers 0, USD still 80000 |
| late approve | expired, late tap refused, transfers 0 |
| stale approval | tap refused, still awaiting_human, transfers 0 |
| changed plan | execute refused, transfers stayed 1 |
| deposit revises funding | FX buy 10000, transfers 1 |
| partial completion | FX ok, transfer error, USD changed, no paid receipt |
| stale finish unknown | shared ledger kept the other row. The message says the call was not undone and the result is unknown. transfers 0 |

## Public page

`/fixture` is MOCK FIXTURE and read only. It does not take a desk key and it does not query Convex. Download `GET /fixture/receipt`. The ops desk at `/` stays locked when `DESK_APPROVE_SECRET` is set.

## Not proved here

No sandbox write in this slice. `lib/airwallex/corridor.ts` returns `ran: false` and the missing env names `AIRWALLEX_CLIENT_ID` and `AIRWALLEX_API_KEY` when they are absent. It does not invent ids. Convex restart is still the in-memory handler plus an injected fake client, not a deployed database. A provider create that already left during a lease expiry cannot be unsent by the ledger.
