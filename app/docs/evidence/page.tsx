import { DocHead, Next, Source, Table, blob } from "../kit";

const c = (text: string) => <code>{text}</code>;

export default function Evidence() {
  return (
    <article>
      <DocHead kicker="Evidence" title="What ran, where, and what it printed.">
        <p>Everything here is a file in the repo, except the Nov 12 sandbox login check, which is stated as a limit. Times are as recorded in those files.</p>
      </DocHead>

      <h2>Live model runs, mock provider</h2>
      <p>
        Transcripts from <code>npm run demo:agents -- --out docs/agent-runs</code>. Each names the planner and Wringer model ids, every OpenRouter
        reply (redacted, truncated) and the mock call counts. The Airwallex side is the MOCK fixture in every run. No money moves.
      </p>
      <Table
        head={["Transcript", "Recorded", "Outcome"]}
        rows={[
          [<a key="a" href={blob("docs/agent-runs/2026-11-13-live-ernie-free-model-moves-converged.json")}>model-moves-converged</a>, "Nov 13 2026, 02:53 UTC, head 59b2335", "Model proposed the moves. Round 1 the model Wringer blocked on the reserve floor. Round 2 the code check blocked it (reserve_breach). Round 3 approved. 1 payee update, 3 quotes, 1 conversion, 1 transfer."],
          [<a key="b" href={blob("docs/agent-runs/2026-11-13-live-ernie-free-model-moves-blocked.json")}>model-moves-blocked</a>, "Nov 13 2026, 02:49 UTC, same head", "Blocked in all 3 rounds by model findings. 0 mock transfers. When the two keys cannot agree, nothing is paid."],
          [<a key="c" href={blob("docs/agent-runs/2026-11-13-live-ernie-free-after-beneficiary-fix.json")}>after-beneficiary-fix</a>, "Nov 13 2026, 02:37 UTC, head 239ce92", "Schema v1: the model wrote the plan summary and extra findings, code filed the moves. Round 1 blocked, round 2 approved. 1 transfer."],
          [<a key="d" href={blob("docs/agent-runs/2026-11-13-live-ernie-free-before-beneficiary-fix.json")}>before-beneficiary-fix</a>, "Nov 13 2026, 02:18 UTC", "Blocked in all 3 rounds, 0 transfers. The model Wringer raised the unchanged-payee gap, which the beneficiary fix then closed."],
        ]}
      />
      <p className="doc-fine">Model: {c("baidu/ernie-5.5-flash-preview:free")} on OpenRouter for planner and Wringer. Earlier attempts on other free models got HTTP 429 on every call and were not committed.</p>

      <h2>Fresh machine, Daytona, Nov 12 2026</h2>
      <p>Two throwaway sandboxes, each a fresh public clone, then {c("npm ci")}, {c("npm run proof")} and {c("npm run evidence")}. No keys set, so the SANDBOX step skipped.</p>
      <Table
        head={["Run", "Shape", "npm run proof"]}
        rows={[
          ["run-2-2vcpu-2gib", "2 vCPU, 2 GiB RAM", "ok: 138 tests in 26 files, leak scan clean, matrix 21 pass 0 fail, SANDBOX skipped"],
          ["run-1-1vcpu-1gib", "1 vCPU, 1 GiB RAM", "Failed: the Next build inside the leak scan was killed for memory (exit 137). Tests, demo, rerun and matrix still passed."],
        ]}
      />
      <p className="doc-fine">Source tested: main at {c("f8d915a")}. Debian 13, Node v24.22.1. That is why the quickstart asks for 2 GiB.</p>

      <h2>Airwallex sandbox</h2>
      <ul>
        <li>2026-10-27: login 201, balances 200, quote, conversion SETTLED, transfer driven SENT then FAILED, read back CANCELLED. Final line {c("result pass quote=true conversion=true transfer=true")}.</li>
        <li>2026-10-28: rerun. Conversion and transfer {c("already_done")}. No second create, no second transition.</li>
        <li>2026-11-12: rerun with the credentials on hand. Login returned 403. No ids created.</li>
      </ul>

      <h2>Failure matrix</h2>
      <p>{c("npm run matrix")}: 21 pass, 0 fail. Measured counts for each row are in <a href={blob("docs/JUDGE.md")}>docs/JUDGE.md</a>.</p>

      <Source paths={["docs/agent-runs/", "docs/fresh-machine/2026-11-12-daytona/", "docs/ops-note.md", "docs/JUDGE.md"]} />
      <Next href="/docs" label="Back to the overview" />
    </article>
  );
}
