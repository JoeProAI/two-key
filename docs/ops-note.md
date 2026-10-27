# Ops note — live sandbox smoke (2026-10-27)

Sandbox only. No payout was created. No secret values were printed, and no `.env` was written.

## Env presence

Checked this agent's process environment, a login shell, and every readable process environment. Names only:

| Name | Set |
|---|---|
| `AIRWALLEX_CLIENT_ID` | no |
| `AIRWALLEX_API_KEY` | no |
| `AIRWALLEX_WEBHOOK_SECRET` | no |
| `AIRWALLEX_LOGIN_AS` | no |

There is no `.env` file in the repo checkout. `.env.example` still has empty placeholders.

## Live auth

**No.**

`getAirwallex` was called with `AIRWALLEX_MODE=live` and `AIRWALLEX_BASE_URL=https://api.sandbox.airwallex.com`, which constructs the client in `lib/airwallex/live.ts`. `createLiveClient` threw before any network call because those two server env vars are missing. Nothing was sent to `POST /api/v1/authentication/login` or `GET /api/v1/balances/current`.

The sandbox simulation helper `simulateTransferTransition` (`POST /api/v1/simulation/transfers/{id}/transition`) is already in the live client. It needs a transfer id, so it was not called. No transfer was created.

## Next step

This agent booted from environment build `bld-20261027-c79794fe-15c5-44c2-a4de-3115607b4170` and did not receive `AIRWALLEX_CLIENT_ID` or `AIRWALLEX_API_KEY`. Confirm both names are Runtime Secrets on the saved Cursor environment for this repo (server-only, never `NEXT_PUBLIC_`, never committed). Secret changes apply to agents that start after they are saved. An agent that boots from a build picks them up once a newer build of that environment finishes.

After login and `GET /api/v1/balances/current` succeed:

1. Set `AIRWALLEX_WEBHOOK_SECRET` (also unset here).
2. Wire Convex: `npx convex dev`, then `TWO_KEY_INGEST_SECRET` and `CONVEX_URL` (both unset here).
3. Simulate one sandbox transfer through `FAILED`, then `CANCELLED`, using `simulateTransferTransition` and the existing `request_id` lookup. Still no real money.
