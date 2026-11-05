# Two-Key demo video

Target 4:00. Hard cap 5:00. Record the terminal first. The site is optional. Every beat points at a receipt field. Mock only unless a separate sandbox run is on camera and labeled SANDBOX.

Before recording, run `npm run evidence` once so the counts match what you say. Keep `.env.local` off camera.

| Time | On screen | Say, pointing at |
|---|---|---|
| 0:00 | `npm run evidence` header `MOCK FIXTURE evidence` | This is a mock. No live money. |
| 0:20 | Matrix rows for duplicate webhook, out-of-order, reserve breach | One failure counted once. Created-at says CANCELLED. The floor blocks the naive plan before any send. |
| 0:50 | `npm run demo` Round 1 BLOCK lines | The planner retries twice. The Wringer blocks double pay, a drifting request id, and the reserve. |
| 1:20 | Round 2 summary and `Decision: approved, approved by joe` | One stable retry, buy 28000 USD, defer the retainer. The tap is bound to that plan. |
| 1:45 | Executed lines and `Transfer calls: 1` | Defer, then FX, then the transfer. USD available ends at 10000. |
| 2:10 | `npm run demo -- rerun` `already_done` lines | Same request ids. Transfer calls stay 1. Conversion calls stay 1. |
| 2:35 | Matrix rows: failed provider send, partial completion, stale finish unknown | A failed FX does not get a paid receipt. A transfer error after FX is partial: money for the FX did move, the transfer is not marked paid. A stale finish does not claim the provider call was undone. |
| 3:05 | Matrix rows: approval timeout, late approve, approve without desk key | No tap, nothing moves. A late tap is refused. A missing desk key cannot approve. |
| 3:25 | `npm run demo -- deposit` evidence line and `buy 10000` | A USD 18000 deposit after the block changes the FX size. Code sets the amount. |
| 3:45 | `/fixture?beat=paid` spine and receipt download | The same fields, on one page, labeled MOCK FIXTURE. The download is the JSON pack. |
| 4:00 | Close on the request id `7ff012e1-94ad-76e3-0ebc-d5b0221e876e` | One supplier payment. One request id. One transfer. |

If it runs long, drop the deposit beat and say the matrix row instead.
