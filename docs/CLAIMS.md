# Claims

Every claim in README.md, and the command that checks it. All commands run offline on the mock provider unless the row says SANDBOX or OpenRouter.

| Claim | Verify |
|---|---|
| The $40k Northwind incident runs end to end in MOCK with no keys. | `npm ci && npm run demo` |
| The second run is `already_done` with no second send. | `npm run demo -- rerun` |
| Every deterministic failure case passes. | `npm run matrix` (21 pass, 0 fail) |
| 22 test files, all green, plus lint, types and leak scan. | `npm run check` |
| One command reproduces the judge path. | `npm run proof` (writes `artifacts/proof/summary.md`) |
| A SANDBOX corridor ran on 2026-10-27, rerun 2026-10-28. | Read `docs/ops-note.md`. Rerun: `AIRWALLEX_CLIENT_ID=... AIRWALLEX_API_KEY=... npm run proof` (SANDBOX) |
| Each desk step maps to a named Airwallex endpoint, function and test. | `docs/AIRWALLEX-MAP.md` |
| The receipt reads Goal, Plan, New information, Revised decision, Resulting state. | `npm run demo`; `tests/scenarios.test.ts` "labels Goal, Plan, New information, Revised decision, Resulting state on the receipt" |
| The planner and Wringer run through OpenRouter when configured, and code stays authoritative. | `OPENROUTER_API_KEY=... OPENROUTER_MODEL_PLANNER=... OPENROUTER_MODEL_WRINGER=... npm run demo:agents` (OpenRouter); `npx vitest run tests/agents-live.test.ts` |
| Without OpenRouter env, `demo:agents` names what is missing and exits non-zero. | `npm run demo:agents; echo $?` prints 2 |
| In live mode the model proposes the moves; code recomputes ids, blocks any amount, payee or quote that differs from the evidence, and the model cannot clear a block. Stub mode is deterministic. | `npx vitest run tests/agents-planner.test.ts tests/wringer-hard-stop.test.ts tests/agents-live.test.ts` |
| A live model proposed the moves, code blocked its round 2 plan, it revised, and one transfer went out (mock provider). | `docs/agent-runs/2026-11-13-live-ernie-free-model-moves-converged.json`: rounds[1].codeFindings has `reserve_breach`, rounds[2].decision is `approved`, one transfer call. Reproduce with `npm run demo:agents -- --out docs/agent-runs` and the OpenRouter env. |
| A retry never goes to a payee the bank rejected; the payee is corrected to supplier-confirmed names first. | `npx vitest run tests/beneficiary-fix.test.ts`; matrix row "retry to unchanged payee" |
| The receipt shows the original read back CANCELLED with no money held, before the retry. | `npm run demo`, line "New information" |
| `npm run proof`, `demo` and `evidence` leave the git tree clean. | `npm run proof && git status --short` prints nothing |
| A `request_id` is stable per intent, action and money fields. | `npx vitest run tests/request-id.test.ts` |
| Duplicate and out-of-order webhooks are handled. | `npx vitest run tests/webhooks.test.ts` |
| Approval expires after 4 hours. | matrix rows "approval timeout", "late approve" |
| The approve control follows the bound terms. | `npx vitest run tests/desk-order.test.ts` |
| Secrets stay server side. | `npx vitest run tests/key-leak.test.ts && npm run leak-scan` |
| The live client refuses any host but the sandbox. | `npx vitest run tests/corridor.test.ts tests/live-smoke-guards.test.ts` |
| No em dash in app, lib, docs or README. | `npx vitest run tests/copy-rules.test.ts` |
| The source zip unpacks and runs. | `npm run pack:source`, then `cd two-key && npm ci && npm run demo` in the unpacked folder (Node 20.9 or newer) |
| MIT licensed. | `LICENSE` |

## Known limits

See the Known limits section in `docs/RED-TEAM.md`. In short: the desk build has not run against the sandbox, `payout.transfer.cancelled` delivery is unconfirmed, the OpenRouter path is stub-tested until a transcript is committed, Convex is unconfigured, and the typed name is a label, not authentication.
