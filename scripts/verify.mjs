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
 *   pnpm verify:full   fast gate + build + bundle size + e2e (~4min)
 *     what CI and a release tag run
 *
 * The fast static checks stay serial. They are CPU-bound, and running them all
 * at once made the gate slower in measurement: 95s wall instead of 35s, long
 * enough to trip a 30s unit-test timeout. The independent, mostly-I/O stages
 * are parallel: build with coverage integrity, then bundle size with e2e.
 *
 * EXIT CODES
 *
 *   0  every step passed
 *   1  a step failed — the failing step's own output is printed in the summary
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
 * `test:coverage` already runs the unit suite and enforces thresholds, so there
 * is no separate `test` step — running both would double the wall clock to
 * re-prove the same thing.
 */
const FAST_CHECK_STEPS = [
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
  { name: "locale parity", cmd: ["pnpm", "run", "check:locales"] },
  { name: "hardcoded text", cmd: ["pnpm", "run", "check:hardcoded-text"] },
  {
    name: "relative units",
    cmd: ["pnpm", "run", "check:no-px"],
    note: "no new px in shipped UI source",
  },
];

/** Reads the report written by `unit + coverage`. */
const COVERAGE_INTEGRITY = {
  name: "coverage integrity",
  cmd: ["pnpm", "run", "check:coverage-integrity"],
  note: "fails if a configured file is missing from the report",
};

const BUILD_STEP = {
  name: "build",
  cmd: ["pnpm", "run", "build"],
  env: { SENTRY_AUTH_TOKEN: "" },
};

const POST_BUILD_STEPS = [
  {
    name: "bundle size",
    cmd: ["pnpm", "run", "check:bundle-size"],
    note: "fails when built JS grows past its measured budget",
  },
  {
    name: "e2e",
    cmd: ["pnpm", "run", "test:e2e"],
    env: { E2E_SKIP_BUILD: "1" },
    // The long step streams so a four-minute run does not look like a hang.
    stream: true,
  },
];

/**
 * A stage is a dependency boundary. Steps inside `parallel: true` stages do
 * not read each other's output; steps inside serial stages are CPU-bound and
 * faster one at a time.
 */
const stages = FULL
  ? [
      { steps: FAST_CHECK_STEPS },
      { steps: [BUILD_STEP, COVERAGE_INTEGRITY], parallel: true },
      { steps: POST_BUILD_STEPS, parallel: true },
    ]
  : [
      { steps: FAST_CHECK_STEPS.slice(0, 4) },
      { steps: [COVERAGE_INTEGRITY] },
      { steps: FAST_CHECK_STEPS.slice(4) },
    ];

const steps = stages.flatMap((stage) => stage.steps);

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

    // Capture every step so a failure can be summarised. Only the long e2e
    // step streams live; buffering the short parallel steps keeps their output
    // from interleaving into unreadable noise.
    let captured = "";
    const tap = (chunk) => {
      const text = chunk.toString();
      captured += text;
      if (step.stream) process.stdout.write(text);
    };
    child.stdout.on("data", tap);
    child.stderr.on("data", tap);

    child.on("close", (code) => {
      res({ code: code ?? 1, ms: Date.now() - started, captured });
    });
  });
}

/** Last few meaningful lines of a failed step, for the summary. */
function tail(captured, n = 12) {
  return strip(captured)
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0 && !/^\s*at\s/.test(l))
    .slice(-n);
}

function announce(stage) {
  for (const step of stage.steps) {
    const label = `${String(steps.indexOf(step) + 1).padStart(2)}/${steps.length}  ${step.name}`;
    process.stdout.write(CYAN(`  ${label.padEnd(34)}`));
    if (step.note) process.stdout.write(DIM(`  ${step.note}`));
    process.stdout.write("\n");
  }
}

console.log(
  BOLD(`\n  verify${FULL ? ":full" : ""}`) + DIM(`  (${steps.length} steps)\n`)
);

const startedAt = Date.now();
const results = [];
const failures = [];

for (const stage of stages) {
  announce(stage);

  const stageResults = stage.parallel
    ? await Promise.all(stage.steps.map(run))
    : await (async () => {
        const out = [];
        for (const step of stage.steps) out.push(await run(step));
        return out;
      })();

  for (const [i, result] of stageResults.entries()) {
    const step = stage.steps[i];
    const secs = (result.ms / 1000).toFixed(1);
    results.push({ name: step.name, code: result.code, secs });
    const tick = result.code === 0 ? GREEN(`✓ ${secs}s`) : RED(`✗ ${secs}s`);
    process.stdout.write(`  ${" ".repeat(34)}${tick}\n`);

    if (result.code !== 0) {
      failures.push({ step, output: result.captured });
    }
  }
  process.stdout.write("\n");

  // A later stage cannot meaningfully run on top of a failed dependency: a
  // type error makes unit-test output noise, and the build/e2e pair cannot run
  // without the extension that an earlier build was meant to produce.
  if (failures.length > 0) break;
}

const ran = results.length;
const passed = results.filter((r) => r.code === 0).length;
const total = ((Date.now() - startedAt) / 1000).toFixed(1);

console.log(DIM("  " + "─".repeat(52)));
for (const r of results) {
  const mark = r.code === 0 ? GREEN("✓") : RED("✗");
  console.log(`  ${mark} ${r.name.padEnd(28)} ${DIM(r.secs + "s")}`);
}
if (ran < steps.length) {
  console.log(DIM(`  · ${steps.length - ran} step(s) not run`));
}
console.log(DIM(`  ${passed}/${ran} passed · ${total}s wall\n`));

if (failures.length > 0) {
  for (const { step, output } of failures) {
    console.log(RED(BOLD(`  FAILED: ${step.name}`)) + "\n");
    for (const line of tail(output)) {
      console.log(DIM("  │ ") + line);
    }
    console.log(DIM(`\n  Re-run this step alone: pnpm run ${step.cmd[2]}\n`));
  }
  process.exit(1);
}

console.log(
  GREEN(BOLD(`  All ${passed} checks passed.`)) +
    (FULL
      ? "\n"
      : DIM("\n  Not included here: build, e2e. Use `pnpm verify:full`.\n"))
);
