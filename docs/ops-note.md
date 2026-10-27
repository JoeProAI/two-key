# Ops note — 2026-10-27

Verification only. No product changes. Sandbox only; no money moved.

## What ran green

- `npm install --legacy-peer-deps`
- `npm run check`: eslint, `tsc --noEmit`, vitest (9 files, 41 tests), leak-scan (`next build`, 19 client-facing files clean)
- `npm run demo` and `npm run demo -- rerun | stale-quote | approval | approval-timeout`

Mock behavior held: Wringer blocked the double-pay plan, the executor used stable `request_id`s, the rerun reported `already_done` and created no second payment, the stale quote was re-quoted, the approval waited then paid once, and the timeout expired with zero transfers.

## Live auth

**No.** `AIRWALLEX_CLIENT_ID` and `AIRWALLEX_API_KEY` are not set in this agent's environment. No `.env` was created and no login call was made. `AIRWALLEX_MODE` stayed unset (mock default).

## Next build step

Add the sandbox `AIRWALLEX_CLIENT_ID` and `AIRWALLEX_API_KEY` as Cursor Cloud Agent runtime secrets (never `NEXT_PUBLIC_`, never committed). Then set `AIRWALLEX_MODE=live` and `AIRWALLEX_BASE_URL=https://api.sandbox.airwallex.com` and prove `POST /api/v1/authentication/login` plus `GET /api/v1/balances/current`.

After that login works: set `AIRWALLEX_WEBHOOK_SECRET`, run `npx convex dev` and set `TWO_KEY_INGEST_SECRET` plus `CONVEX_URL`, then simulate one sandbox transfer (`FAILED`, then `CANCELLED`) through the existing `request_id` lookup. Still no real money.
