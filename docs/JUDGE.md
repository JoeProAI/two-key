# Judges

Measured on 2026-11-07 from this working tree, mock mode, no model key, no Convex, no Airwallex call.

`npm run check`: lint, typecheck, 110 tests, leak-scan clean (26 client files, 12 needles), Next.js 15.5.27 build. No skipped tests. The faces are files in `app/fonts`, so the production build does not download them.

## 90 seconds

```bash
npm ci && npm run check && npm run evidence
```

`npm run evidence` prints the matrix, then three labeled scenarios: `main`, `replay`, and `deposit`. They do not share a mock. `main` provider ids are not the replay's. It writes `artifacts/receipts/northwind-latest.json`, `artifacts/receipts/replay.json`, `artifacts/receipts/deposit.json`, and CSVs beside them. `docs/shots/northwind-receipt.json` is the main pack from that command. `docs/shots/replay-identity.json` is the fresh-process comparison from that command. Provider ids change when the process changes. These request ids stay, because each one includes the money fields:

| Move | Payload in the key | request_id |
|---|---|---|
| FX conversion, buy 28000 USD with EUR | 28000 USD / EUR | `e57286ec-aede-36bc-62c1-ed72e395d09d` |
| FX conversion, buy 10000 USD with EUR | 10000 USD / EUR | `11872280-b7eb-0f0c-a139-589310f5fda2` |
| Retry transfer | 40000 USD, original transfer, beneficiary | `c624d34b-1b4c-cbfb-723a-e3f5d031cd83` |

A repeated key is the same action. A different buy amount is a different key. The same key with a different payload is an error and does not send.

## What `npm run demo` printed

Mode line: `MOCK FIXTURE`. This run is independent of replay.

Round 1 blocks: `double_payment`, `unstable_request_id`, `reserve_breach`. Notes: `duplicate_webhook` (`evt_failed_01` x2, counted once) and `out_of_order_webhook` (arrival PROCESSING, created_at CANCELLED).

Round 2: one stable retry, buy 28000 USD with EUR, defer the 7000 retainer. Decision `approved, approved by joe`.

Executions: defer ok, FX ok (`e57286ec-aede-36bc-62c1-ed72e395d09d`), retry ok (`c624d34b-1b4c-cbfb-723a-e3f5d031cd83`).

Balances after, from the mock ledger: USD available 10000, pending 0, reserved 0, total 10000. EUR available 34074.07, pending 0, reserved 0, total 34074.07.

How those numbers are produced in this mock: start USD 22000 and EUR 60000, both with pending 0 and reserved 0 so total equals available. The conversion buys 28000 USD and sells 25925.93 EUR (`round(28000 / 1.08, 2 cents)`). The transfer pays 40000 USD. USD available becomes 22000 + 28000 - 40000 = 10000. EUR available becomes 60000 - 25925.93 = 34074.07. An accepted create settles immediately, so pending and reserved stay 0 and total is set to available. The 10000 floor is a Two-Key rule. It is not `reserved_amount`. This is mock math, not a live Airwallex balance.

Counters: transfer calls 1, transfers settled 1, conversion calls 1, conversions settled 1, quotes 1.

## What `npm run demo -- replay` printed

One isolated scenario. Pass 1 pays. Pass 2 is a new process with a copy of that mock and no create calls. It reconciles the original actions.

`main` and `replay` print the same request ids because those ids are a pure function of the 28000 USD buy and the 40000 USD retry. Their provider ids differ. They are not one run. Pass 1 and pass 2 inside `docs/shots/replay-identity.json` share the FX request id, the 28000 buy, the FX provider id, the retry request id, the 40000 amount, and the transfer provider id. Pass 2 results are `already_done`. Pass 2 calls are transfer 0, conversion 0, quote 0. Settled stays 1 and 1 because the snapshot already held the objects.

A second `npm run demo` on a client that already has the live retry does not replan and does not ask for a 40000 quote. It returns: "This intent already has a live retry transfer. Reconcile the original receipt. This run did not replan or pay."

## Matrix

`npm run matrix` on the same day: 20 pass, 0 fail. Columns are attempts and settled objects. Settled counts an object the mock stored. A thrown call is an attempt with settled 0.

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
| changed plan before send | refused before any send, transfer calls 0, settled 0 |
| payload mismatch after success | same request id, buy changed to 40000, error, conversion calls stayed 1, settled stayed 1 |
| replay after changed balances | already_done, same provider id, quotes stayed 1 |
| partial then retry | FX already_done, same conversion id, transfer calls 2, transfers settled 1 |
| snapshot keeps provider id | fresh client calls 0, settled 1, same provider ids |
| deposit revises funding | FX buy 10000, its own request id, transfer calls 1, settled 1 |
| partial completion | FX ok, transfer error, transfer calls 1, transfers settled 0 |
| stale finish unknown | shared ledger kept the other row. The message says the call was not undone and the result is unknown. transfers 0 |

## Public page

`/fixture` is MOCK FIXTURE and read only. It does not take a desk key and it does not query Convex. Beats: `incident`, `blocked` (round 1 only, nothing sent), `planned`, `failed`, `paid`, `replay`. Download `GET /fixture/receipt`. The ops desk at `/` stays locked when `DESK_APPROVE_SECRET` is set.

## Not proved here

No sandbox write in this slice. `lib/airwallex/corridor.ts` returns `ran: false` and the missing env names `AIRWALLEX_CLIENT_ID` and `AIRWALLEX_API_KEY` when they are absent. It does not invent ids. Convex restart is still the in-memory handler plus an injected fake client, not a deployed database. A provider create that already left during a lease expiry cannot be unsent by the ledger.
