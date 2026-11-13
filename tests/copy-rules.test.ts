import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["app", "lib", "docs", "README.md"];
const TEXT = /\.(tsx?|mjs|css|md|json)$/;

function files(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((name) => files(join(path, name)));
}

describe("copy rules", () => {
  const all = ROOTS.flatMap(files).filter((f) => TEXT.test(f));

  it("no em dash (U+2014) in app/, lib/, docs/, or README.md", () => {
    const hits = all.filter((f) => readFileSync(f, "utf8").includes("\u2014"));
    expect(hits).toEqual([]);
  });

  it("no hashtags in README.md or docs/", () => {
    const hits = all
      .filter((f) => f.endsWith(".md"))
      .flatMap((f) => readFileSync(f, "utf8").split("\n").map((line, i) => ({ f, i, line })))
      .filter(({ line }) => !/^\s*#{1,6}\s/.test(line) && !line.trimStart().startsWith("```"))
      .filter(({ line }) => /(^|\s)#[A-Za-z][\w-]*/.test(line.replace(/`[^`]*`/g, "").replace(/\]\([^)]*\)/g, "")))
      .map(({ f, i }) => `${f}:${i + 1}`);
    expect(hits).toEqual([]);
  });
});
