import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chatRaw, missingAgentEnv, parseModelJSON, type ChatJSON } from "../lib/agents/openrouter";
import { createMockClient } from "../lib/airwallex/mock";
import { runDemo } from "../lib/scenario";
import { redact } from "../lib/receipt/redact";

// npm run demo:agents [-- --out docs/agent-runs]
// Northwind on the MOCK provider, with the planner and Wringer consulted through OpenRouter.
// Hard Wringer checks stay in code and stay authoritative. Model text is advisory and schema-checked.
// No Airwallex call is made. No money moves.
const HARD_CHECKS = new Set(["duplicate_webhook", "double_payment", "unstable_request_id", "out_of_order_webhook", "cancelled_not_failed", "original_still_live", "failed_not_yet_cancelled", "stale_fx_quote", "reserve_breach", "beneficiary_unchanged_after_mismatch", "beneficiary_correction_unverified", "original_debit_not_returned"]);

const missing = missingAgentEnv(process.env);
if (missing.length) {
  console.error(`demo:agents needs ${missing.join(", ")}. Nothing was sent to OpenRouter.`);
  console.error("Example: OPENROUTER_API_KEY=... OPENROUTER_MODEL_PLANNER=google/gemma-4-31b-it:free OPENROUTER_MODEL_WRINGER=google/gemma-4-31b-it:free npm run demo:agents");
  process.exit(2);
}

const outFlag = process.argv.indexOf("--out");
const outDir = outFlag > 0 && process.argv[outFlag + 1] ? process.argv[outFlag + 1] : "artifacts/agent-runs";
const key = process.env.OPENROUTER_API_KEY!;
const scrub = (text: string) => redact(text.split(key).join("[redacted]").replace(/\d{12,}/g, "[digits]"));
const env: NodeJS.ProcessEnv = { ...process.env, AGENT_MODE: "llm" };

type Call = { role: string; model: string; served?: string; ok: boolean; parsed: boolean; raw?: string; error?: string };
const calls: Call[] = [];
const chat: ChatJSON = async (role, system, user, callEnv) => {
  const model = (role === "planner" ? env.OPENROUTER_MODEL_PLANNER : env.OPENROUTER_MODEL_WRINGER)!;
  try {
    const reply = await chatRaw(role, system, user, callEnv ?? env);
    const call: Call = { role, model, served: reply.served, ok: true, parsed: false, raw: scrub(reply.content.slice(0, 4000)) };
    calls.push(call);
    const parsed = parseModelJSON(reply.content);
    call.parsed = true;
    return parsed;
  } catch (e) {
    const last = calls.at(-1);
    const msg = scrub(e instanceof Error ? e.message : String(e));
    if (last && last.role === role && last.ok && !last.parsed && !last.error) last.error = `unparsed: ${msg}`;
    else calls.push({ role, model, ok: false, parsed: false, error: msg });
    throw e;
  }
};

const awx = createMockClient();
const res = await runDemo(awx, { approver: "joe", agents: { env, chat } });
const started = new Date().toISOString();
const transcript = {
  schema: "two-key.agent-run.v1",
  at: started,
  provider: "MOCK Airwallex fixture. No Airwallex call. No money moved.",
  models: { planner: env.OPENROUTER_MODEL_PLANNER, wringer: env.OPENROUTER_MODEL_WRINGER },
  rule: "Hard Wringer checks are code. Model objections can add, never clear. The planner model may only replace the summary text.",
  calls,
  rounds: res.rounds.map((r) => ({
    round: r.proposal.round,
    summary: r.proposal.summary,
    actions: r.proposal.actions.map((a) => a.kind),
    findings: r.findings.map((f) => ({ check: f.check, severity: f.severity, source: HARD_CHECKS.has(f.check) ? "code" : "model", detail: f.detail })),
    decision: r.decision.status,
  })),
  calls_to_mock: awx.calls,
  receipt: res.receipt?.lines ?? null,
};
const safe = JSON.parse(scrub(JSON.stringify(transcript)));
mkdirSync(outDir, { recursive: true });
const file = join(outDir, `${started.replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify(safe, null, 2) + "\n");

const usable = calls.filter((c) => c.parsed).length;
console.log("Mode: MOCK provider, live OpenRouter agents");
console.log(`Models: planner ${transcript.models.planner}, wringer ${transcript.models.wringer}`);
console.log(`Model calls: ${calls.length}, parsed: ${usable}, fell back to code: ${calls.length - usable}`);
for (const r of transcript.rounds) console.log(`Round ${r.round}: ${r.decision}. ${r.findings.filter((f) => f.severity === "block").map((f) => `${f.source} BLOCK ${f.check}`).join(", ") || "no block"}`);
console.log(`Mock transfer creates: ${awx.calls.createTransfer}`);
console.log(`Transcript: ${file}`);
if (awx.calls.createTransfer > 1) process.exit(3);
if (!usable) {
  console.error("No model reply was usable. The run fell back to code for every call.");
  process.exit(1);
}
