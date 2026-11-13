# Agent runs

Transcripts from `npm run demo:agents -- --out docs/agent-runs`. Each file names the planner and Wringer model ids, every OpenRouter reply (redacted, truncated), which findings came from code and which from the model, and the mock transfer count. The Airwallex side is the MOCK fixture in every run. No money moves.

Run it yourself:

```bash
OPENROUTER_API_KEY=... OPENROUTER_MODEL_PLANNER=google/gemma-4-31b-it:free OPENROUTER_MODEL_WRINGER=google/gemma-4-31b-it:free npm run demo:agents -- --out docs/agent-runs
```

Without those three variables the command prints the missing names and exits 2. Nothing is sent.
