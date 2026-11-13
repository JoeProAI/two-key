# Two-Key proof pack

Generated 2026-11-13T03:21:46.279Z by `npm run proof`. Git f8d915a47b08b13a50428fc534ac9ac9403ca439.
MOCK rows use hand-written fixtures. No real money moves.

| Step | Result | Note |
|---|---|---|
| Node 24.22.1 (needs >= 20.9) | ok |  |
| node_modules from npm ci | ok |  |
| npm run check (lint, typecheck, tests, build + leak scan) | FAIL | exit 1 |
| npm run demo (Northwind, MOCK) | ok |  |
| npm run demo -- rerun (second run is already_done, no second send) | ok |  |
| npm run matrix (failure matrix) | ok |  |
| SANDBOX corridor | skipped | SANDBOX skipped: AIRWALLEX_CLIENT_ID, AIRWALLEX_API_KEY not set. No provider call was made and no sandbox id was invented. Mock proof above is complete without them. |

Tests: 138 passed in 26 files.

Matrix: 21 pass, 0 fail.
Sandbox corridor: skipped (keys absent).
