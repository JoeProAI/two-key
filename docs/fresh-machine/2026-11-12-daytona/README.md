# Fresh-machine proof on Daytona, Thu Nov 12 2026

Two throwaway Daytona sandboxes, each deleted right after its run (`get()` on both ids returns not found). Each one did a fresh `git clone https://github.com/JoeProAI/two-key.git` from the public repo, then `npm ci`, `npm run proof` and `npm run evidence`. No keys were set in either sandbox, so the SANDBOX corridor step skipped, as it does for any judge without Airwallex keys.

Source tested: main at `f8d915a47b08b13a50428fc534ac9ac9403ca439` (the PR #8 merge).
Machine: image `daytonaio/sandbox:0.11.0`, Debian 13 (trixie), Node v24.22.1, npm 11.19.1, git 2.56.0, region us. Full details in each run's `environment.txt` and `sandbox.json`.

| Run | Shape | Times (ET) | npm ci | npm run proof | npm run evidence |
|---|---|---|---|---|---|
| `run-2-2vcpu-2gib/` | 2 vCPU, 2 GiB RAM, 5 GiB disk | 10:23:18 to 10:24:18 PM | ok | **ok**: 138 tests in 26 files, leak scan clean (26 files, 12 needles), matrix 21 pass 0 fail, SANDBOX skipped | ok, tree clean afterwards |
| `run-1-1vcpu-1gib/` | 1 vCPU, 1 GiB RAM, 3 GiB disk (Daytona default) | 10:20:39 to 10:21:50 PM | ok | **FAILED**: `next build` inside the leak scan was killed for memory (exit 137). Tests (138), demo, rerun and matrix (21/0) still passed. | ok |

## What this tells a judge
- The judge path works on a machine nobody set up: clone, `npm ci && npm run proof`.
- It needs more than 1 GiB of RAM. The Next.js production build inside the leak scan was killed at 1 GiB and passed at 2 GiB. README states 2 GiB as the minimum.
- In run 1 the `PROOF_EXIT=0` line in `sandbox.json` is wrong: the runner put `$?` inside double quotes, so the outer shell expanded it before the command ran. `npm run proof` itself printed `proof: FAILED` and exits 1 on any failed step (scripts/proof.mjs). Run 2 uses single quotes and records the real exit code.

## Rerun it
`python3 docs/fresh-machine/2026-11-12-daytona/run_on_daytona.py 2` with `pip install daytona` (0.231.1) and `DAYTONA_API_KEY` set. The argument is GiB of RAM. The script deletes the sandbox in a `finally` block. Cost at Daytona's published rates for both runs together: well under one cent.
