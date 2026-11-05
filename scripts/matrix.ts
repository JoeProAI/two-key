import { mkdirSync, writeFileSync } from "node:fs";
import { matrixText, runMatrix } from "../lib/matrix/run";

const rows = await runMatrix();
const text = matrixText(rows);
console.log(text);
mkdirSync("artifacts/evidence", { recursive: true });
writeFileSync("artifacts/evidence/matrix.json", JSON.stringify({ generatedBy: "npm run matrix", rows }, null, 2));
if (rows.some((r) => !r.pass)) process.exit(1);
