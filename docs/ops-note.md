# Ops note: Airwallex sandbox live auth

Checked 2026-10-27 on a fresh VM. Secret values are not in this note.

## Env (presence only)

| Name | Set |
|---|---|
| `AIRWALLEX_CLIENT_ID` | yes |
| `AIRWALLEX_API_KEY` | yes |

`AIRWALLEX_MODE` and `AIRWALLEX_BASE_URL` were unset in the VM environment. The proof process set `AIRWALLEX_MODE=live` and `AIRWALLEX_BASE_URL=https://api.sandbox.airwallex.com`. `lib/airwallex/live.ts` is the only code that read the client id and API key.

## Live auth: yes

`createLiveClient` from `lib/airwallex/live.ts`, then `getBalances()`:

| Call | Result |
|---|---|
| `POST /api/v1/authentication/login` | 201 |
| `GET /api/v1/balances/current` | 200 |

The balances response was an array of 46 currency rows. Non-zero `available_amount` (sandbox wallet, major units): USD 10000000, EUR 10000000, GBP 10000000, CNY 10000000. Every other currency in the array was 0 available, pending, and reserved.

No token, client id, or API key was printed or written down.
