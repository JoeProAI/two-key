# Airwallex map

Desk step, the Airwallex endpoint it maps to, the code that calls it, and the test that checks the request. The public desk answers every row with the mock provider (`lib/airwallex/mock.ts`). Only `npm run live-smoke` and the optional step in `npm run proof` call the sandbox host.

| Desk step | Endpoint | Code (`lib/airwallex/live.ts` unless noted) | Test |
|---|---|---|---|
| Sign in | `POST /api/v1/authentication/login` | `createLiveClient` → `login`, `authenticate` | `tests/live-client.test.ts` "reuses the token until near expires_at", "refreshes an expired token", "authenticate reports login status and does not return a token" |
| Read cash | `GET /api/v1/balances/current` | `getBalances` | `tests/live-client.test.ts` "reuses the token until near expires_at" (asserts the URL) |
| Price the FX | `POST /api/v1/fx/quotes/create` | `createQuote` | `tests/no-double-pay.test.ts` "blocks a stale FX quote" (Wringer side); request shape in `scripts/live-smoke.ts` |
| Convert | `GET /api/v1/fx/conversions?request_id=`, then `POST /api/v1/fx/conversions/create` | `findConversionByRequestId`, `createConversion` (looks the id up again on any create error) | `tests/conversion-lookup.test.ts` "live client uses the documented list and retrieve endpoints", "live createConversion falls back to the request_id lookup when create errors" |
| Pay | `GET /api/v1/transfers?request_id=`, then `POST /api/v1/transfers/create` | `findTransferByRequestId`, `createTransfer` | `tests/live-client.test.ts` "sends amounts as major-unit strings"; `tests/no-double-pay.test.ts` "re-running the executor makes no new Airwallex calls", "sends the documented transfer reason" |
| Re-read the original | `GET /api/v1/transfers/{id}` | `getTransfer` | `tests/no-double-pay.test.ts` "blocks a retry while the original is SENT or PAID" |
| Drive the failure (sandbox only) | `POST /api/v1/simulation/transfers/{id}/transition` | `simulateTransferTransition`; hop order in `lib/airwallex/transfer-drive.ts` `driveFailedThenCancelled` | `tests/transfer-drive.test.ts` "goes PROCESSING to SENT to FAILED, then sees the auto-cancel on GET" |
| Hear about it | Webhooks `payout.transfer.failed`, `payout.transfer.cancelled` into `POST /api/webhooks/airwallex` | `app/api/webhooks/airwallex/route.ts`, `lib/webhooks/verify.ts`, `lib/webhooks/inbox.ts` | `tests/webhooks.test.ts` "rejects tampered body, wrong secret, missing headers, stale timestamp", "counts a re-delivered event once and orders by created_at, not arrival" |
| Host guard | any | `sandboxOrigin` refuses every host except `api.sandbox.airwallex.com` | `tests/live-smoke-guards.test.ts` |

## Recorded sandbox run, 2026-10-27

Recorded sandbox run, 2026-10-27, rerun 2026-10-28. The public desk runs the same corridor against a mock provider. Source: `docs/ops-note.md`.

| Step | Result |
|---|---|
| Login | 201 |
| Balances | 200 |
| FX quote | `878e1b2c-070a-3b39-9b69-0a60291f9ec6`, EUR to USD |
| Conversion | `32a3bfa6-0c1e-408b-986e-84a45f472449`, SETTLED |
| Transfer | `4e1dab1a-c59b-413b-92d5-813f6caafd59`, SENT, FAILED (`BENEFICIARY_NAME_MISMATCH`), read back CANCELLED |
| Rerun 2026-10-28 | conversion and transfer `already_done`, no second create, no second transition |

These ids came from `scripts/live-smoke.ts`, not from the current desk build. To rerun with your own sandbox keys:

```bash
AIRWALLEX_CLIENT_ID=... AIRWALLEX_API_KEY=... npm run proof
```
