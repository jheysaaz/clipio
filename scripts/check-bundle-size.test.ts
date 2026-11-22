/**
 * Tests for the shipped matcher and budget evaluator in check-bundle-size.mjs.
 *
 * The gate script is loaded by source-slicing rather than imported because it is
 * a .mjs executable with no exported API. Slicing keeps these tests aimed at the
 * real code that runs in the gate, not a copy that can drift away from it — the
 * same approach scripts/check-coverage-integrity.test.ts uses.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const SCRIPT = resolve(process.cwd(), "scripts/check-bundle-size.mjs");

type Budget = { name: string; pattern: string; maxBytes: number };
type Result = Budget & {
  bytes: number;
  matched: string[];
  overBy: number;
  ok: boolean;
};

type Checker = {
  globToRegExp: (glob: string) => RegExp;
  matchesPattern: (pattern: string, path: string) => boolean;
  evaluateBudgets: (
    fileSizes: Record<string, number>,
    budgets: Budget[]
  ) => Result[];
};

function loadChecker(): Checker {
  const source = readFileSync(SCRIPT, "utf-8");
  const start = source.indexOf("function globToRegExp");
  const end = source.indexOf("function collectJavaScriptSizes");
  expect(start, "globToRegExp not found in the script").toBeGreaterThan(-1);
  expect(end, "budget evaluator not found in the script").toBeGreaterThan(
    start
  );
  const body = source.slice(start, end);
  return new Function(
    `${body}\nreturn { globToRegExp, matchesPattern, evaluateBudgets };`
  )() as Checker;
}

const checker = loadChecker();

describe("globToRegExp", () => {
  it("matches an exact file and nothing that merely shares its prefix", () => {
    const regex = checker.globToRegExp("background.js");

    expect(regex.test("background.js")).toBe(true);
    expect(regex.test("background.js.map")).toBe(false);
    expect(regex.test("chunks/background.js")).toBe(false);
  });

  it("treats a single star as staying inside one segment", () => {
    const regex = checker.globToRegExp("chunks/popup-*.js");

    expect(regex.test("chunks/popup-ABC123.js")).toBe(true);
    expect(regex.test("chunks/nested/popup-ABC123.js")).toBe(false);
  });

  it("treats double-star-slash as zero or more directories", () => {
    const regex = checker.globToRegExp("**/*.js");

    expect(regex.test("background.js")).toBe(true);
    expect(regex.test("chunks/popup-ABC123.js")).toBe(true);
    expect(regex.test("chunks/deep/nested/chunk.js")).toBe(true);
    expect(regex.test("assets/font.woff2")).toBe(false);
  });
});

describe("evaluateBudgets", () => {
  const budget: Budget = {
    name: "popup entry",
    pattern: "chunks/popup-*.js",
    maxBytes: 100,
  };

  it("passes at exactly the budget", () => {
    const [result] = checker.evaluateBudgets({ "chunks/popup-ABC.js": 100 }, [
      budget,
    ]);

    expect(result?.ok).toBe(true);
    expect(result?.bytes).toBe(100);
    expect(result?.overBy).toBe(0);
  });

  it("fails when a matching file grows past the budget", () => {
    const [result] = checker.evaluateBudgets({ "chunks/popup-ABC.js": 101 }, [
      budget,
    ]);

    expect(result?.ok).toBe(false);
    expect(result?.overBy).toBe(1);
  });

  it("sums every file a pattern matches", () => {
    const [result] = checker.evaluateBudgets(
      {
        "chunks/popup-A.js": 60,
        "chunks/popup-B.js": 40,
        "chunks/options-A.js": 90,
      },
      [budget]
    );

    expect(result?.bytes).toBe(100);
    expect(result?.matched).toEqual(["chunks/popup-A.js", "chunks/popup-B.js"]);
  });

  it("fails when a pattern matches nothing instead of treating it as zero", () => {
    const [result] = checker.evaluateBudgets({ "chunks/options-A.js": 10 }, [
      budget,
    ]);

    expect(result?.ok).toBe(false);
    expect(result?.matched).toEqual([]);
    expect(result?.bytes).toBe(0);
  });

  it("keeps budget order stable for a readable report", () => {
    const results = checker.evaluateBudgets(
      { "background.js": 1, "chunks/popup-A.js": 2 },
      [
        { name: "popup", pattern: "chunks/popup-*.js", maxBytes: 10 },
        { name: "background", pattern: "background.js", maxBytes: 10 },
      ]
    );

    expect(results.map((result) => result.name)).toEqual([
      "popup",
      "background",
    ]);
  });
});
