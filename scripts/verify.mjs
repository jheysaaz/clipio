/**
 * One command for the full gate.
 *
 * WHY THIS EXISTS
 *
 * The workflow previously said "run these five things in the right order":
 *
 *     pnpm test:coverage && pnpm compile && pnpm lint
 *
 * That is a list a human or an agent has to remember, in the right order, every
 * time. Any single omission is silent. The repo's own history shows the cost:
 * `tsconfig.e2e.json` was referenced by nothing, so an entire type-check simply
 * never ran, and eight errors accumulated in the suite that gates every release.
 *
 * `pnpm verify` makes the gate a single exit code. A step that is not listed here
 * does not gate anything, which is the property worth having.
 *
 * THE TWO TIERS
 *
 *   pnpm verify        fast gate — runs on every save/commit (~35s)
 *     format, lint, types, unit tests with coverage, and the integrity gate
 *     that makes the coverage number trustworthy
 *
 *   pnpm verify:full   fast gate + build + e2e (~4min)
 *     what CI and a release tag run
 *
 * Ordering is deliberate: cheap and specific failures first, so the first error
 * printed is usually the real one. Each step prints its own elapsed time and the
 * running total, because "the suite is slow" and "step 3 hung" are different
 * problems.
 *
 * EXIT CODES
 *
 *   0  every step passed
 *   1  a step failed — the failing step's own output is already on screen
 *
 * `--full` is the only flag; an unknown flag is ignored rather than rejected, so
 * there is no third exit code.
 */

import { spawn } from "child_process";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const FULL = process.argv.includes("--full");

/** Strip ANSI so the summary is readable when piped to a file. */
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

const CYAN = (s) => `\x1b[36m${s}\x1b[0m`;
const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;
const BOLD = (s) => `\x1b[1m${s}\x1b[0m`;

/**
 * The fast gate.
 *
 * `test:coverage` already runs the unit suite and enforces thresholds, so there
 * is no separate `test` step — running both would double the wall clock to
 * re-prove the same thing.
 *
 * `check:coverage-integrity` runs AFTER coverage because it reads
 * `coverage/coverage-final.json`.
 */
const FAST_STEPS = [
  { name: "format", cmd: ["pnpm", "run", "format:check"] },
  { name: "lint", cmd: ["pnpm", "run", "lint"] },
  {
    name: "types",
    cmd: ["pnpm", "run", "compile"],
    // One step, one tsconfig. src, tests, e2e and the three config files are
    // all in the same program, so there is no second config that can be
    // orphaned the way tsconfig.e2e.json once was — and wxt.config.ts and
    // vitest.config.ts are checked, which they previously were not.
    note: "one project; nothing can fall out of it",
  },
  { name: "unit + coverage", cmd: ["pnpm", "run", "test:coverage"] },
  {
    name: "coverage integrity",
    cmd: ["pnpm", "run", "check:coverage-integrity"],
    note: "fails if a configured file is missing from the report",
  },
  { name: "locale parity", cmd: ["pnpm", "run", "check:locales"] },
  { name: "hardcoded text", cmd: ["pnpm", "run", "check:hardcoded-text"] },
];

const FULL_STEPS = [
  {
    name: "build",
    cmd: ["pnpm", "run", "build"],
    env: { SENTRY_AUTH_TOKEN: "" },
  },
  {
    name: "e2e",
    cmd: ["pnpm", "run", "test:e2e"],
    env: { E2E_SKIP_BUILD: "1" },
  },
];

const steps = FULL ? [...FAST_STEPS, ...FULL_STEPS] : FAST_STEPS;

function run(step) {
  return new Promise((res) => {
    const started = Date.now();
    const child = spawn(step.cmd[0], step.cmd.slice(1), {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      // `pnpm run` scripts need a shell to resolve the local bin dir.
      shell: process.platform === "win32",
      env: { ...process.env, ...(step.env ?? {}) },
    });

    // Stream output live so a long step (e2e) shows progress rather than
    // appearing to hang. Capture it too so a failure can be summarised.
    let captured = "";
    const tap = (chunk) => {
      const text = chunk.toString();
      captured += text;
      process.stdout.write(text);
    };
    child.stdout.on("data", tap);
    child.stderr.on("data", tap);

    child.on("close", (code) => {
      res({ code: code ?? 1, ms: Date.now() - started, captured });
    });
  });
}

/** Last few meaningful lines of a failed step, for the summary table. */
function tail(captured, n = 12) {
  return strip(captured)
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0 && !/^\s*at\s/.test(l))
    .slice(-n);
}

console.log(
  BOLD(`\n  verify${FULL ? ":full" : ""}`) + DIM(`  (${steps.length} steps)\n`)
);

const results = [];
let failedAt = -1;
/** Output of the failing step, kept for the summary after the loop breaks. */
let failureOutput = "";

for (const [i, step] of steps.entries()) {
  const label = `${String(i + 1).padStart(2)}/${steps.length}  ${step.name}`;
  process.stdout.write(CYAN(`  ${label.padEnd(34)}`));
  if (step.note) process.stdout.write(DIM(`  ${step.note}`));
  process.stdout.write("\n");

  const { code, ms, captured } = await run(step);
  const secs = (ms / 1000).toFixed(1);
  results.push({ name: step.name, code, secs });

  if (code === 0) {
    process.stdout.write(`  ${" ".repeat(34)}${GREEN(`✓ ${secs}s`)}\n\n`);
  } else {
    process.stdout.write(`  ${" ".repeat(34)}${RED(`✗ ${secs}s`)}\n\n`);
    failedAt = i;
    // Retained for the summary below: the loop breaks here, so this is the only
    // place the failing step's output survives. Reading it from the step's
    // config object instead (as an earlier version did) yielded `undefined`
    // and printed an empty block under every failure.
    failureOutput = captured ?? "";
    // Later steps cannot meaningfully run on top of a failure — a type error
    // makes unit-test output noise, and coverage would not be regenerated.
    break;
  }
}

const ran = results.length;
const passed = results.filter((r) => r.code === 0).length;
const total = results.reduce((a, r) => a + Number(r.secs), 0).toFixed(1);

console.log(DIM("  " + "─".repeat(52)));
for (const r of results) {
  const mark = r.code === 0 ? GREEN("✓") : RED("✗");
  console.log(`  ${mark} ${r.name.padEnd(28)} ${DIM(r.secs + "s")}`);
}
if (ran < steps.length) {
  console.log(DIM(`  · ${steps.length - ran} step(s) not run`));
}
console.log(DIM(`  ${passed}/${ran} passed · ${total}s total\n`));

if (failedAt !== -1) {
  const step = steps[failedAt];
  console.log(RED(BOLD(`  FAILED: ${step.name}`)) + "\n");
  // `failureOutput`, not `step.captured` — the latter is the step's *config*
  // object and has no output on it, so the summary was silently reading
  // `undefined` and printing an empty block under every failure.
  for (const line of tail(failureOutput)) {
    console.log(DIM("  │ ") + line);
  }
  console.log(DIM(`\n  Re-run this step alone: pnpm run ${step.cmd[2]}\n`));
  process.exit(1);
}

console.log(
  GREEN(BOLD(`  All ${passed} checks passed.`)) +
    (FULL
      ? "\n"
      : DIM("\n  Not included here: build, e2e. Use `pnpm verify:full`.\n"))
);
