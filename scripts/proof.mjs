// One-command proof pack. Mock path always. Airwallex SANDBOX corridor only when keys are present.
// npm run proof              full run (install check, check, demo, demo rerun, matrix, optional sandbox)
// npm run proof -- --skip-check   same, without lint/typecheck/tests/build (for a quick unpack test)
// Writes artifacts/proof/summary.md and step logs. Never prints or writes secret values.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const OUT = "artifacts/proof";
const skipCheck = process.argv.includes("--skip-check");
mkdirSync(OUT, { recursive: true });

// Sandbox keys may sit in a gitignored .env.local. Read only the Airwallex names; never print them.
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^\s*(AIRWALLEX_CLIENT_ID|AIRWALLEX_API_KEY|AIRWALLEX_API_KY)\s*=\s*(.*)\s*$/.exec(line);
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const SECRET_NAMES = ["AIRWALLEX_CLIENT_ID", "AIRWALLEX_API_KEY", "AIRWALLEX_API_KY", "AIRWALLEX_WEBHOOK_SECRET", "OPENROUTER_API_KEY", "TWO_KEY_INGEST_SECRET", "DESK_APPROVE_SECRET"];
const secretValues = SECRET_NAMES.map((n) => process.env[n]).filter((v) => v && v.length >= 6);

function redact(text) {
  let out = text;
  for (const v of secretValues) out = out.split(v).join("[redacted]");
  // Long digit runs look like account numbers. Keep the last 4.
  return out.replace(/\b\d{8,}\b/g, (m) => `****${m.slice(-4)}`);
}

const rows = [];
function step(id, label, cmd, args, { env, expect } = {}) {
  process.stdout.write(`\n=== ${label} ===\n`);
  const res = spawnSync(cmd, args, { encoding: "utf8", env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
  const log = redact(`${res.stdout ?? ""}${res.stderr ?? ""}`);
  process.stdout.write(log);
  writeFileSync(`${OUT}/${id}.log`, log);
  let ok = res.status === 0;
  let note = ok ? "" : `exit ${res.status}`;
  if (ok && expect) {
    const miss = expect.filter((needle) => !log.includes(needle));
    if (miss.length) { ok = false; note = `missing: ${miss.join(", ")}`; }
  }
  rows.push({ id, label, ok, note, log });
  return { ok, log };
}

// 1. Install check
const major = Number(process.versions.node.split(".")[0]);
const nodeOk = major >= 20;
rows.push({ id: "node", label: `Node ${process.versions.node} (needs >= 20.9)`, ok: nodeOk, note: nodeOk ? "" : "upgrade Node", log: "" });
const installed = existsSync("node_modules/.package-lock.json");
rows.push({ id: "install", label: "node_modules from npm ci", ok: installed, note: installed ? "" : "run npm ci first", log: "" });
if (!nodeOk || !installed) finish();

// 2. Check
if (!skipCheck) step("check", "npm run check (lint, typecheck, tests, build + leak scan)", "npm", ["run", "check"]);
else rows.push({ id: "check", label: "npm run check", ok: true, note: "skipped by --skip-check", log: "" });

// 3. Demo, rerun, matrix. Mock only. AIRWALLEX_MODE forced to mock so a local .env.local cannot flip these.
const mock = { AIRWALLEX_MODE: "mock", AGENT_MODE: "stub" };
step("demo", "npm run demo (Northwind, MOCK)", "npm", ["run", "demo"], {
  env: mock,
  expect: ["Mode: MOCK FIXTURE", "Decision: approved", "Transfer calls: 1 settled: 1"],
});
step("rerun", "npm run demo -- rerun (second run is already_done, no second send)", "npm", ["run", "demo", "--", "rerun"], {
  env: mock,
  expect: ["result=already_done", "Pass 2 calls transfer=0 conversion=0 quote=0"],
});
step("matrix", "npm run matrix (failure matrix)", "npm", ["run", "matrix"], { env: mock });

// 4. Optional sandbox corridor. Runs twice: the second run must find the same request_ids (already_done).
const clientId = process.env.AIRWALLEX_CLIENT_ID;
const apiKey = process.env.AIRWALLEX_API_KEY || process.env.AIRWALLEX_API_KY;
let sandbox = "skipped";
if (clientId && apiKey) {
  const env = {
    AIRWALLEX_MODE: "live",
    AIRWALLEX_BASE_URL: "https://api.sandbox.airwallex.com",
    AIRWALLEX_CLIENT_ID: clientId,
    AIRWALLEX_API_KEY: apiKey,
  };
  const first = step("sandbox-1", "SANDBOX corridor run 1 (login, balances, FX quote + conversion, transfer, FAILED then CANCELLED)", "npm", ["run", "live-smoke"], { env, expect: ["result pass"] });
  const second = step("sandbox-2", "SANDBOX corridor run 2 (same request_ids, expect already_done)", "npm", ["run", "live-smoke"], { env, expect: ["already_done", "result pass"] });
  sandbox = first.ok && second.ok ? "pass" : "fail";
  writeFileSync(`${OUT}/sandbox-evidence.txt`, ["SANDBOX. Airwallex sandbox host only. Not live money.", "", "--- run 1 ---", first.log, "--- run 2 ---", second.log].join("\n"));
} else {
  const missing = [!clientId && "AIRWALLEX_CLIENT_ID", !apiKey && "AIRWALLEX_API_KEY"].filter(Boolean);
  const msg = `SANDBOX skipped: ${missing.join(", ")} not set. No provider call was made and no sandbox id was invented. Mock proof above is complete without them.`;
  console.log(`\n=== SANDBOX corridor ===\n${msg}`);
  rows.push({ id: "sandbox", label: "SANDBOX corridor", ok: true, skipped: true, note: msg, log: "" });
}

finish();

function finish() {
  const tests = /Tests\s+(\d+) passed/.exec(rows.find((r) => r.id === "check")?.log ?? "")?.[1];
  const files = /Test Files\s+(\d+) passed/.exec(rows.find((r) => r.id === "check")?.log ?? "")?.[1];
  const leak = /leak-scan: [^\n]+/.exec(rows.find((r) => r.id === "check")?.log ?? "")?.[0];
  const matrix = rows.find((r) => r.id === "matrix")?.log ?? "";
  const pass = (matrix.match(/ \| pass \| /g) ?? []).length;
  const fail = (matrix.match(/ \| fail \| /g) ?? []).length;
  const allOk = rows.every((r) => r.ok);
  const git = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout?.trim() || "unknown";
  const md = [
    "# Two-Key proof pack",
    "",
    `Generated ${new Date().toISOString()} by \`npm run proof${skipCheck ? " -- --skip-check" : ""}\`. Git ${git}.`,
    "MOCK rows use hand-written fixtures. No real money moves.",
    "",
    "| Step | Result | Note |",
    "|---|---|---|",
    ...rows.map((r) => `| ${r.label} | ${r.skipped ? "skipped" : r.ok ? "ok" : "FAIL"} | ${r.note || ""} |`),
    "",
    tests ? `Tests: ${tests} passed in ${files} files.` : "Tests: not run.",
    leak ? `Leak scan: ${leak.replace("leak-scan: ", "")}` : "",
    matrix ? `Matrix: ${pass} pass, ${fail} fail.` : "",
    `Sandbox corridor: ${sandbox === "skipped" ? "skipped (keys absent)" : sandbox}.`,
    "",
  ].filter((l) => l !== undefined).join("\n");
  writeFileSync(`${OUT}/summary.md`, md);
  console.log(`\n${md}\nproof: ${allOk ? "ok" : "FAILED"}. Logs in ${OUT}/.`);
  process.exit(allOk ? 0 : 1);
}
