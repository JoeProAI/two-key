import { spawnSync } from "node:child_process";

const run = (args: string[]) => {
  const res = spawnSync("npx", ["tsx", "--conditions=react-server", ...args], { stdio: "inherit" });
  if (res.status !== 0) process.exit(res.status ?? 1);
};

console.log("MOCK FIXTURE evidence. No live host.");
console.log("main and replay are separate scenarios. Do not read one's provider ids as the other's.\n");
run(["scripts/matrix.ts"]);
console.log("\n--- independent scenario: main ---");
run(["scripts/demo.ts", "main"]);
console.log("\n--- isolated scenario: replay (pass 1, then a fresh process) ---");
run(["scripts/demo.ts", "replay"]);
console.log("\n--- independent scenario: deposit ---");
run(["scripts/demo.ts", "deposit"]);
