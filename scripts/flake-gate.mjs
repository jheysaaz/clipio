/**
 * Flake gate.
 *
 * THE PROBLEM IT SOLVES
 *
 * This repo runs Playwright with `retries: 0`, and that is correct: a retry hides
 * a flake rather than fixing it (AGENTS.md Testing Standards rule 12). But a
 * policy of "no retries, no detection" is not a policy — it is a coin flip, and
 * the cost lands on release tags.
 *
 * It already has. v1.6.0 shipped from this exact commit:
 *
 *     CI:      25b503be569aff66cd72eb573403e835cf89dd51  success
 *     Publish: 25b503be569aff66cd72eb573403e835cf89dd51  failure
 *
 * Same SHA, different outcome. A 5s timeout waiting for the first new browser
 * tab, racing the background worker's own onboarding tab. CI got lucky; the
 * release did not.
 *
 * WHAT THIS DOES
 *
 * Runs the suite N times and classifies each test:
 *
 *   N/N failures  → deterministic. A real failure. Not a flake. Not quarantinable.
 *   1..N-1        → FLAKE. Fails the gate, loudly and specifically.
 *   0/N, but
 *   listed in the quarantine → allowed, if unexpired.
 *
 * A quarantined test that now passes N/N is reported as RELEASED and the gate
 * says so, so a fixed flake is discovered rather than sitting in the ledger.
 *
 * WHY THIS DOES NOT JUST SET `retries: 2`
 *
 * Because a retry passes. The suite goes green, the race is still in the code,
 * and the next person to touch it inherits a race they cannot see. Here the run
 * can fail *and* tell you which test is racy and how often, which is the
 * information a retry throws away.
 *
 * Usage:
 *   pnpm test:flake                 # 3 runs, no quarantine enforcement
 *   pnpm test:flake -- --runs=5
 */

import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "fs";
import { spawn } from "child_process";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const LEDGER = join(ROOT, ".github/flake-quarantine.yml");

const args = process.argv.slice(2);
const RUNS = Number(
  (args.find((a) => a.startsWith("--runs=")) || "").split("=")[1] || 3
);
const ENFORCE = !args.includes("--no-enforce");

if (!Number.isInteger(RUNS) || RUNS < 2) {
  console.error("Usage: pnpm test:flake [--runs=N] [--no-enforce]  (N >= 2)");
  process.exit(2);
}

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const YELLOW = (s) => `\x1b[33m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;
const BOLD = (s) => `\x1b[1m${s}\x1b[0m`;

// ---------------------------------------------------------------------------
// Quarantine ledger — a minimal parser, not a YAML dependency.
// ---------------------------------------------------------------------------
//
// The ledger is a flat list of mappings, so parsing it by hand avoids adding
// js-yaml (already present) to a script that CI runs. The shape is fixed and
// commented in the file itself.

function loadLedger() {
  if (!existsSync(LEDGER)) return [];
  const text = readFileSync(LEDGER, "utf-8");
  const entries = [];
  let current = null;
  for (const line of text.split("\n")) {
    const item = line.match(/^\s*-\s+(\w+):\s*(.+)$/);
    if (item) {
      if (current) entries.push(current);
      current = { [item[1]]: item[2].replace(/^["']|["']$/g, "") };
      continue;
    }
    const kv = line.match(/^\s+(\w+):\s*(.+)$/);
    if (kv && current) current[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  if (current) entries.push(current);
  return entries;
}

const ledger = loadLedger();
const today = new Date().toISOString().slice(0, 10);

/** Entries past their expiry are ignored — the point of the deadline. */
const active = ENFORCE
  ? ledger.filter((e) => !e.expires || e.expires >= today)
  : [];
const expired = ENFORCE
  ? ledger.filter((e) => e.expires && e.expires < today)
  : [];
const quarantinedNames = active.map((e) => e.test);

if (expired.length > 0) {
  console.error(
    `\n${RED(BOLD("  Quarantine expired."))} ${expired.length} entr(ies) past their expiry date:\n`
  );
  for (const e of expired) {
    console.error(`   ${RED("✗")} ${e.test}`);
    console.error(
      `     expired ${RED(e.expires)} · reason: ${e.reason ?? "—"}`
    );
  }
  console.error(
    DIM(
      `\n   Fix the flake, or renew the entry in .github/flake-quarantine.yml with a\n` +
        `   new date and a reason. Renewing silently is how a quarantine becomes a\n` +
        `   graveyard — a graveyard is worse than a red build because it looks handled.\n`
    )
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Run the suite N times, collecting pass/fail per test.
// ---------------------------------------------------------------------------

/**
 * Playwright JSON report → Map<testId, boolean passed>
 *
 * A test's `status` is the *expectation verdict* — Playwright reports
 * `"expected"` for a test that passed and `"unexpected"` for one that failed,
 * not `"passed"`/`"failed"`. Reading it as the latter makes every test look
 * failed. The per-attempt `results[].status` is the one that says
 * `"passed"`/`"failed"`/`"timedOut"`, so that is what is used here.
 */
function parseReport(reportPath) {
  const results = new Map();
  if (!existsSync(reportPath)) return results;
  const data = JSON.parse(readFileSync(reportPath, "utf-8"));

  const walk = (suite, file) => {
    const spec = suite.file ?? file;
    for (const specEntry of suite.specs ?? []) {
      for (const testCase of specEntry.tests ?? []) {
        const id = `${strip(spec)} › ${specEntry.title}`;
        const key = `${id} [${testCase.projectName ?? ""}]`.replace(
          / \[\]/,
          ""
        );

        // Last attempt wins. With retries:0 there is exactly one attempt, but
        // reading the last rather than the first keeps this correct if retries
        // are ever reintroduced for a diagnostic run.
        const last = testCase.results?.[testCase.results.length - 1];
        const passed =
          last?.status === "passed" ||
          // `expected` is Playwright's word for "passed as intended".
          testCase.status === "expected";

        if (!results.has(key) || passed) results.set(key, passed);
      }
    }
    for (const child of suite.suites ?? []) walk(child, spec);
  };

  for (const suite of data.suites ?? []) walk(suite, undefined);
  return results;
}

function runOnce(n) {
  return new Promise((res) => {
    const outDir = mkdtempSync(join(tmpdir(), `clipio-flake-${n}-`));
    const child = spawn(
      "pnpm",
      ["exec", "playwright", "test", "--reporter=json"],
      {
        cwd: ROOT,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PLAYWRIGHT_JSON_OUTPUT_NAME: join(outDir, "report.json"),
        },
      }
    );
    let err = "";
    child.stdout.on("data", (d) => (err += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", () => {
      res({ report: join(outDir, "report.json"), out: strip(err) });
    });
  });
}

console.log(
  BOLD(`\n  flake gate`) +
    DIM(
      `  ${RUNS} runs · retries:0 · quarantine: ${quarantinedNames.length} active\n`
    )
);

const tally = new Map(); // testKey → number of runs it PASSED
let run = 0;

while (run < RUNS) {
  run++;
  process.stdout.write(DIM(`  run ${run}/${RUNS} … `));
  const { report, out } = await runOnce(run);
  const results = parseReport(report);
  let passed = 0;
  for (const [key, ok] of results) {
    if (ok) passed++;
    tally.set(key, (tally.get(key) ?? 0) + (ok ? 1 : 0));
  }
  const total = results.size;
  const failed = total - passed;
  console.log(
    failed === 0
      ? `${GREEN(`✓ ${passed}/${total}`)}\n`
      : `${RED(`✗ ${passed}/${total} passed`)}  (${failed} failed)\n`
  );
  if (failed > 0) {
    for (const line of out
      .split("\n")
      .filter((l) => /✘|✗/.test(l))
      .slice(0, 8)) {
      console.log(DIM(`     ${line.trim()}`));
    }
  }
}

// ---------------------------------------------------------------------------
// Classify.
// ---------------------------------------------------------------------------

const flakes = [];
const hardFailures = [];
const alwaysPassed = [];

for (const [key, passes] of tally) {
  const observed = Math.min(passes, RUNS);
  if (observed === RUNS) {
    alwaysPassed.push(key);
    continue;
  }
  // Present in every run's report but failed at least once.
  if (observed === 0) hardFailures.push(key);
  else flakes.push({ key, passes: observed });
}

const stillQuarantined = flakes.filter((f) =>
  quarantinedNames.some((q) => f.key.includes(q))
);
const newFlakes = flakes.filter(
  (f) => !quarantinedNames.some((q) => f.key.includes(q))
);
// A quarantined test that now always passes should leave the ledger.
const releasable = alwaysPassed.filter((k) =>
  quarantinedNames.some((q) => k.includes(q))
);

console.log(DIM("  " + "─".repeat(52)));
console.log(
  `  ${alwaysPassed.length} stable · ${flakes.length} flaky · ${hardFailures.length} hard failure(s)`
);

let failed = false;

if (newFlakes.length > 0) {
  failed = true;
  console.error(
    `\n${RED(BOLD(`  ${newFlakes.length} NEW FLAKE(S) — not in the quarantine ledger`))}\n`
  );
  for (const f of newFlakes) {
    console.error(`   ${RED("✗")} ${f.key}`);
    console.error(
      DIM(
        `     failed ${RUNS - f.passes}/${RUNS} runs — this is a race, not a broken test`
      )
    );
  }
  console.error(
    DIM(
      `\n   Fix the race. If it cannot be fixed now, add an entry to\n` +
        `   .github/flake-quarantine.yml with a reason and an expiry date — a\n` +
        `   quarantine with a deadline is honest; a retry is not.\n`
    )
  );
}

if (stillQuarantined.length > 0) {
  console.log(
    `\n  ${YELLOW("⚠")} ${stillQuarantined.length} quarantined flake(s) still present:`
  );
  for (const f of stillQuarantined) {
    console.log(DIM(`     ${f.key} (passed ${f.passes}/${RUNS})`));
  }
}

if (releasable.length > 0) {
  console.log(
    `\n  ${GREEN("✓")} ${releasable.length} quarantined test(s) now pass ${RUNS}/${RUNS} — remove them from the ledger:`
  );
  for (const k of releasable) console.log(DIM(`     ${k}`));
}

if (hardFailures.length > 0) {
  failed = true;
  console.error(
    `\n${RED(BOLD(`  ${hardFailures.length} hard failure(s) — deterministic, not flaky`))}\n`
  );
  for (const k of hardFailures) console.error(`   ${RED("✗")} ${k}`);
}

if (failed) process.exit(1);

console.log(
  `\n  ${GREEN(BOLD("No flakes."))} ${DIM(`(${RUNS}/${RUNS} runs agreed on every test)`)}\n`
);
