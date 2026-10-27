# Ops note — live sandbox smoke (2026-10-27)

Sandbox only. No payout was created. No secret values were printed, and no `.env` was written.

## Env presence

Checked this agent's process environment, a login shell, and every readable process environment. Names only:

| Name | First check | Recheck after secrets were saved |
|---|---|---|
| `AIRWALLEX_CLIENT_ID` | no | no |
| `AIRWALLEX_API_KEY` | no | no |
| `AIRWALLEX_WEBHOOK_SECRET` | no | no |
| `AIRWALLEX_LOGIN_AS` | no | no |

There is no `.env` file in the repo checkout. `.env.example` still has empty placeholders.

The recheck is the same process this agent booted with. Saving Cursor environment secrets does not reload `process.env` in an agent that is already running. No newer environment build has finished since boot (latest succeeded build is still `bld-20261027-c79794fe-15c5-44c2-a4de-3115607b4170`).

## Live auth

**No.**

On the first check, `getAirwallex` was called with `AIRWALLEX_MODE=live` and `AIRWALLEX_BASE_URL=https://api.sandbox.airwallex.com`, which constructs the client in `lib/airwallex/live.ts`. `createLiveClient` threw before any network call because those two server env vars are missing. Nothing was sent to `POST /api/v1/authentication/login` or `GET /api/v1/balances/current`.

The recheck found both variables still unset, so login and `GET /api/v1/balances/current` were not sent again.

The sandbox simulation helper `simulateTransferTransition` (`POST /api/v1/simulation/transfers/{id}/transition`) is already in the live client. It needs a transfer id, so it was not called. No transfer was created.

## Next step

Joe reports the Cursor environment secrets are saved. This already-running agent still does not have `AIRWALLEX_CLIENT_ID` or `AIRWALLEX_API_KEY` in `process.env`, so login was not retried. A new agent has to start after the save. An agent that boots from a build picks up secret changes once a newer build of that environment finishes. Keep both names as Runtime Secrets (server-only, never `NEXT_PUBLIC_`, never committed).

After login and `GET /api/v1/balances/current` succeed:

1. Set `AIRWALLEX_WEBHOOK_SECRET` (also unset here).
2. Wire Convex: `npx convex dev`, then `TWO_KEY_INGEST_SECRET` and `CONVEX_URL` (both unset here).
3. Simulate one sandbox transfer through `FAILED`, then `CANCELLED`, using `simulateTransferTransition` and the existing `request_id` lookup. Still no real money.
