# Agent runs

Transcripts from `npm run demo:agents -- --out docs/agent-runs`. Each file names the planner and Wringer model ids, every OpenRouter reply (redacted, truncated), which findings came from code and which from the model, and the mock transfer count. The Airwallex side is the MOCK fixture in every run. No money moves.

Run it yourself:

```bash
OPENROUTER_API_KEY=... OPENROUTER_MODEL_PLANNER=google/gemma-4-31b-it:free OPENROUTER_MODEL_WRINGER=google/gemma-4-31b-it:free npm run demo:agents -- --out docs/agent-runs
```

Without those three variables the command prints the missing names and exits 2. Nothing is sent.

## Recorded runs

- `2026-11-13-live-ernie-free-before-beneficiary-fix.json`, Fri Nov 13 2026 02:18 UTC, planner and Wringer `baidu/ernie-5.5-flash-preview:free` on OpenRouter (free tier, no charge). 6 model calls, 6 parsed, 0 fell back. Result: blocked in all 3 rounds, 0 mock transfers. The code blocks in round 1 matched the fixture run. The live Wringer also raised objections the fixture did not: the retry goes to the same beneficiary after a name mismatch with no corrected payee details (`unchanged_beneficiary_details`, `beneficiary_not_fixed`), and no read-back confirms the original debit was returned (`zero_payment_confirmed`). Some of its other blocks were wrong about the flow, for example `approval_required` (approval happens after the Wringer). Because model findings can add blocks but never remove a code block, the run ended blocked, which is the safe outcome. The beneficiary objection was a real gap in the demo story and is being fixed on this branch.
- Earlier attempts the same night with `google/gemma-4-31b-it:free`, `google/gemma-4-26b-a4b-it:free` and `nvidia/nemotron-3.5-super-vl:free` got HTTP 429 (free-tier rate limits) on every call and fell back to code for all 4 calls. Those transcripts were not committed.
