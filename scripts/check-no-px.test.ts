/**
 * Tests for the shipped relative-units gate.
 *
 * The gate is run as a subprocess, not reimplemented in TypeScript. A test that
 * built its own px matcher would prove only that the test agreed with itself;
 * these assertions prove the script `pnpm verify` actually runs accepts the
 * allowed cases and rejects a new arbitrary px.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = resolve(process.cwd());
const SCRIPT = join(ROOT, "scripts/check-no-px.mjs");
const fixtures: string[] = [];

afterEach(() => {
  while (fixtures.length > 0) {
    rmSync(fixtures.pop()!, { recursive: true, force: true });
  }
});

function fixtureNamed(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "clipio-no-px-"));
  fixtures.push(dir);
  const file = join(dir, "Fixture.tsx");
  writeFileSync(file, contents, "utf8");
  return file;
}

function runGate(...paths: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...paths], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

describe("check-no-px", () => {
  it("passes on the shipped src tree", () => {
    const result = runGate();
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it("accepts every explicit allowlist case", () => {
    // Each line exercises one reason the script documents; an accidental
    // tightening that rejects any of them is a false gate failure.
    const file = fixtureNamed(`
      const chrome = \`
        --popup-max-width: 800px;
        --popup-max-height: 600px;
        border: 1px solid;
        outline: 2px solid;
        outline-offset: 1px;
        box-shadow: 0 1px 0 0.5px, 0 2px 3px rgba(0,0,0,.05);
        position: fixed; left: -9999px; top: -9999px;
      \`;
    `);
    const result = runGate(file);
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it("rejects font px", () => {
    // The negative case must come from a real script run: a test-built matcher
    // would stay green even if the gate stopped looking at fonts entirely.
    const file = fixtureNamed(`className="text-[13px]"`);
    const result = runGate(file);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("13px");
  });

  it("rejects spacing and radius px", () => {
    const file = fixtureNamed(`className="p-[12px] rounded-[6px]"`);
    const result = runGate(file);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("12px");
    expect(result.stderr).toContain("6px");
  });

  it("rejects sizing px outside the Chrome cap", () => {
    const file = fixtureNamed(`className="max-h-[320px]"`);
    const result = runGate(file);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("320px");
  });

  it("ignores px in comments, which do not style anything", () => {
    // Documentation accounts for most of the px strings in src; failing on
    // them would train readers to distrust the gate.
    const file = fixtureNamed(`
      // text-[18px] was the old value
      /* padding: 24px */
      className="text-ui-lg"
    `);
    const result = runGate(file);
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
});
