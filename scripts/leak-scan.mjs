// Builds the app with sentinel secrets in the env, then scans every client-facing build
// output for the sentinel values and the secret env var names. Fails on any hit.
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const SENTINELS = {
  AIRWALLEX_CLIENT_ID: "SENTINEL_CLIENT_ID_7c1e",
  AIRWALLEX_API_KEY: "SENTINEL_API_KEY_9f2a",
  AIRWALLEX_WEBHOOK_SECRET: "SENTINEL_WEBHOOK_SECRET_3b8d",
  OPENROUTER_API_KEY: "SENTINEL_OPENROUTER_5e0c",
  TWO_KEY_INGEST_SECRET: "SENTINEL_INGEST_SECRET_a41f",
};
execSync("npx next build", { stdio: "inherit", env: { ...process.env, ...SENTINELS, AIRWALLEX_MODE: "live", NEXT_TELEMETRY_DISABLED: "1" } });

const needles = [...Object.values(SENTINELS), ...Object.keys(SENTINELS)];
const roots = [".next/static", ".next/server/app"].filter(existsSync);
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const hits = [];
let scanned = 0;
for (const r of roots) {
  for (const f of walk(r)) {
    // Client JS everywhere, plus prerendered HTML / RSC payloads sent to browsers.
    if (r === ".next/server/app" && !/\.(html|rsc|body)$/.test(f)) continue;
    scanned++;
    const text = readFileSync(f, "utf8");
    for (const n of needles) if (text.includes(n)) hits.push(`${f}: ${n}`);
  }
}
if (!scanned) throw new Error("leak-scan found no build output to scan");
if (hits.length) {
  console.error("SECRET LEAK in client output:\n" + hits.join("\n"));
  process.exit(1);
}
console.log(`leak-scan: ${scanned} client-facing files clean of ${needles.length} needles.`);
