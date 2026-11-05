import { spawnSync } from "node:child_process";

const run = (args: string[]) => {
  const res = spawnSync("npx", ["tsx", "--conditions=react-server", ...args], { stdio: "inherit" });
  if (res.status !== 0) process.exit(res.status ?? 1);
};

console.log("MOCK FIXTURE evidence. No live host.\n");
run(["scripts/matrix.ts"]);
console.log("");
run(["scripts/demo.ts", "main"]);
console.log("");
run(["scripts/demo.ts", "rerun"]);
