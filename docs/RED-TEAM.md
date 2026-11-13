# Red team

Attacks a skeptical judge would raise, the one-line answer, and the test or command that proves it. Run everything with `npm ci && npm run proof`. Matrix rows come from `npm run matrix`.

| Attack | Answer | Proof |
|---|---|---|
| "It's all mock." | The public desk is MOCK and says so. A real sandbox corridor ran on 2026-10-27 and was rerun on 2026-10-28 with dated ids. Anyone with sandbox keys can rerun it. | `docs/ops-note.md`; `AIRWALLEX_CLIENT_ID=... AIRWALLEX_API_KEY=... npm run proof`; `tests/corridor.test.ts` "does not call the network and names the missing env when keys are absent" |
| "The LLM can move money." | The model may only replace the summary text. Code files every move, amount and `request_id`. | `tests/wringer-hard-stop.test.ts` "does not let the model replace the filed moves or their request ids"; `tests/agents-live.test.ts` "a model that proposes double pay and clears the blocks changes nothing" |
| "The model can clear a Wringer block." | Model objections can add, never clear. A repeat of a hard check is dropped. | `tests/wringer-hard-stop.test.ts` "keeps every blocking check when the model tries to clear them", "drops any model objection that repeats a deterministic check" |
| "Malformed or hostile model output pays." | A reply that is not a JSON object, or a failed call, falls back to code. Round 1 still blocks. | `tests/agents-live.test.ts` "malformed JSON falls back to code: round 1 still blocks, nothing extra is paid", "an OpenRouter error leaves the code plan and the hard checks" |
| "Prompt injection in a webhook field." | Webhook text is data. It never reaches the move list, and the hard checks do not read it. | `tests/agents-live.test.ts` "prompt injection in a webhook memo has no effect on checks or moves" |
| "Webhook replay double pays." | Failures are counted by unique event id, not by delivery. | `tests/webhooks.test.ts` "counts a re-delivered event once and orders by created_at, not arrival"; matrix "duplicate webhook" |
| "Out-of-order webhooks." | Status comes from `created_at` order and a fresh `GET /api/v1/transfers/{id}`, not arrival order. | matrix "out-of-order webhook"; `tests/no-double-pay.test.ts` "blocks a retry while the original is SENT or PAID" |
| "Forged webhooks." | HMAC-SHA256 over timestamp and body, stale timestamps refused. | `tests/webhooks.test.ts` "rejects tampered body, wrong secret, missing headers, stale timestamp" |
| "request_id collisions." | The id is `sha256` of intent, action and money fields. Same id with a different payload refuses to send. | `tests/request-id.test.ts` "is a pure function of intent + action", "a reused request_id is rejected like Airwallex does"; matrix "payload mismatch after success" |
| "Rerun pays again." | The executor looks up the `request_id` first and returns `already_done`. | `npm run demo -- rerun`; `tests/no-double-pay.test.ts` "re-running the executor makes no new Airwallex calls"; matrix "replay after success" |
| "Approval forgery or CSRF on approve." | Approve is a Next.js server action (Next checks Origin against Host). With a desk key set, it also needs an httpOnly, SameSite=Strict cookie that is an HMAC of the key. | `tests/desk-gate.test.ts` "an anonymous caller cannot plan, pay, or replay through the server actions", "the cookie is an HMAC of the key, never the key"; matrix "approve without desk key" |
| "Approve before reading terms." | The approve control sits after the bound terms in DOM and visual order, and the tap is bound to the plan digest and cash evidence. | `tests/desk-order.test.ts` "approval control follows the bound terms in DOM order"; matrix "changed plan before send", "stale approval" |
| "A human tap overrides a block." | It cannot. A forced approved status still does not pay. | `tests/no-double-pay.test.ts` "a human tap cannot override a block, and a forced approved status still does not pay" |
| "Stale FX quote." | A quote needs 60s of headroom or the Wringer blocks and the planner requotes. | `tests/no-double-pay.test.ts` "blocks a stale FX quote"; matrix "stale FX quote" |
| "Reserve breach." | Any plan that ends below the USD 10,000 floor after queued payouts is blocked. | `tests/no-double-pay.test.ts` "blocks a reserve breach"; matrix "reserve breach" |
| "Approval sits forever." | A pending decision expires after 4 hours. A late tap is refused. | matrix "approval timeout", "late approve" |
| "Partial completion." | Funding runs first, the run stops at the first error, and the retry resumes on the same ids. | matrix "partial completion", "partial then retry", "failed provider send" |
| "Two workers race." | A claim lease gives the second worker `busy`. A paused owner cannot overwrite the winner. | `tests/claim-lease.test.ts` "gives a second worker busy while the first holds a live claim", "drops a paused owner's late ok and error after takeover, then keeps the new owner's success"; matrix "claim lease busy" |
| "Secrets leak to the client." | Only `lib/airwallex/live.ts` reads Airwallex keys. Secret modules import `server-only`. No `NEXT_PUBLIC_` secrets. | `tests/key-leak.test.ts`; `npm run leak-scan` |
| "It could hit production Airwallex." | The live client refuses every host except `api.sandbox.airwallex.com`. | `tests/corridor.test.ts` "refuses a production host"; `tests/live-smoke-guards.test.ts` "allows only the sandbox origin" |
| "Fixture ids look real." | Fixture ids end in a run of zeros (for example `...000000000040`), and mock-minted ids appear only under a MOCK label. Every receipt prints `Mode: MOCK FIXTURE`. | `lib/airwallex/fixtures.ts`; `npm run demo`; `tests/desk-order.test.ts` asserts the MOCK label |
| "The photo proves something." | It is atmosphere. Caption: "Illustrative scene, not transaction evidence." `alt=""`. | `app/ui/hero-plate.tsx` |
| "The repo is private." | It stays private until Joe flips it before submission. `npm run pack:source` builds the upload zip in the meantime. | `npm run pack:source` |

## Known limits

- The current desk build has not run against the sandbox. The sandbox evidence is from `scripts/live-smoke.ts` on 2026-10-27 and 2026-10-28.
- `payout.transfer.cancelled` delivery from Airwallex is unconfirmed. No webhook was subscribed during the sandbox run.
- The HTTP code for a duplicate `request_id` on conversion create is unconfirmed. The client looks the id up first and never sent the duplicate.
- The live OpenRouter path is only proved with a stubbed fetch in this repo until a transcript lands in `docs/agent-runs/`.
- Convex is optional and unconfigured. The lease window against a live host is not proved.
- Typing a name on the desk is a demo label, not authentication.
