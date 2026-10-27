# Ops note — live sandbox auth (2026-10-27)

Fresh VM. Sandbox only. No secret values were printed. No `.env` was written. No payout was created.

## Env presence

Checked this agent's `process.env`. Boolean only:

| Name | Set |
|---|---|
| `AIRWALLEX_CLIENT_ID` | yes |
| `AIRWALLEX_API_KEY` | no |
| `AIRWALLEX_MODE` | no |
| `AIRWALLEX_BASE_URL` | no |
| `AIRWALLEX_WEBHOOK_SECRET` | no |
| `AIRWALLEX_LOGIN_AS` | no |
| `TWO_KEY_INGEST_SECRET` | no |
| `CONVEX_URL` | no |

A nonempty environment variable named `AIRWALLEX_API_KY` is present. The name is missing the final `E` of `KEY`. `lib/airwallex/live.ts` reads only `AIRWALLEX_API_KEY`. That misspelled variable was not copied, not printed, and not sent.

This VM booted from environment build `bld-20261027-c79794fe-15c5-44c2-a4de-3115607b4170`. There is no `.env` file in the checkout. `.env.example` still has empty placeholders.

## Live auth

**No.**

`createLiveClient` was called with `AIRWALLEX_MODE=live` and `AIRWALLEX_BASE_URL=https://api.sandbox.airwallex.com`, and with a fetch stub that records any request. It threw before constructing a client:

`AIRWALLEX_MODE=live needs AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY (server env only).`

Fetch count was 0. Nothing was sent to `POST /api/v1/authentication/login` or `GET /api/v1/balances/current`. `simulateTransferTransition` was not called.

## Next step

In the Cursor Cloud Agents environment for this repo, save the sandbox API key under the exact name `AIRWALLEX_API_KEY`. The current name `AIRWALLEX_API_KY` is not read by `lib/airwallex/live.ts`. Keep it server-only (never `NEXT_PUBLIC_`, never committed). `AIRWALLEX_CLIENT_ID` is already set on this VM.

Start a new agent after the rename. Then set `AIRWALLEX_MODE=live` and `AIRWALLEX_BASE_URL=https://api.sandbox.airwallex.com` and prove `POST /api/v1/authentication/login` plus `GET /api/v1/balances/current`.

After that succeeds:

1. Set `AIRWALLEX_WEBHOOK_SECRET` (unset here).
2. Wire Convex: `npx convex dev`, then `TWO_KEY_INGEST_SECRET` and `CONVEX_URL` (both unset here).
3. Simulate one sandbox transfer through `FAILED`, then `CANCELLED`, using `simulateTransferTransition` and the existing `request_id` lookup. Still no real money.
