/**
 * Review packet generator.
 *
 * WHY THIS EXISTS
 *
 * The review step is the most expensive thing in this repo's workflow and the
 * least specified. AGENTS.md says to spawn a separate agent and check "spec
 * adherence" — but hands it a diff and no definition of what adherence means.
 *
 * With nothing authoritative to check against, the reviewer re-derives intent
 * from the diff itself, and then reports requirements the author never intended.
 * The history shows exactly that, repeatedly:
 *
 *     fix: address the third review round — 8 MAJORs, most of them false claims
 *     fix: address the fourth review round — including the false claim this work introduced
 *     fix: address the fifth review round — the "position-precise" fix was a reword
 *
 * Five-plus rounds on one body of work, with multiple rounds whose findings were
 * themselves false. The reviewer was not being careful; it was being ungrounded.
 * Every round of refutation was wasted, and because no rejection was ever
 * written down, the next round re-raised the same finding.
 *
 * So the reviewer gets:
 *
 *   1. the acceptance criteria, extracted — the authoritative definition of done
 *   2. the command output the implementer already produced — not re-run
 *   3. the specs the touched tests claim to derive from
 *   4. the diff, bounded
 *
 * and rules that forbid inventing requirements and forbid re-raising a
 * previously-rejected finding without new evidence.
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not review. It assembles the material a reviewer needs and writes it
 * to `review/<sha>.md`, so the review starts from evidence rather than from a
 * blank prompt. The reviewer prompt lives in `.opencode/agent/reviewer.md`.
 *
 * Usage:
 *   pnpm review:prep                 # current HEAD
 *   pnpm review:prep -- --sha=<sha>  # a specific commit
 */

import { execFileSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const sha = (
  process.argv.find((a) => a.startsWith("--sha="))?.split("=")[1] ?? "HEAD"
).trim();

/** Diff budget, mirroring the reviewer's own rules — see .opencode/agent/reviewer.md. */
const MAX_FILES = 15;
const MAX_LINES = 800;

const git = (...args) =>
  execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });

let target;
try {
  target = sha === "HEAD" ? "HEAD" : git("rev-parse", sha).trim();
} catch {
  console.error(`❌ Unknown revision: ${sha}`);
  process.exit(2);
}

const short = git("rev-parse", "--short", target).trim();

// ---------------------------------------------------------------------------
// Diff scope
// ---------------------------------------------------------------------------

/**
 * Choose the base to diff against.
 *
 * The obvious choice — merge-base with `origin/main` — reports an EMPTY diff for
 * any commit already on main, which is most of them when preparing a packet for
 * in-progress work or for an already-landed change. Reviewing nothing and
 * calling it clean is the worst failure mode available here, so the base is
 * chosen in this order:
 *
 *   1. merge-base with origin/main, when that is an ancestor producing a
 *      non-empty diff — i.e. the commit sits on an unmerged branch.
 *   2. otherwise the commit's first parent, so a single commit — including one
 *      already merged — reviews exactly its own change.
 */
function resolveBase(rev) {
  try {
    const mb = git("merge-base", rev, "origin/main").trim();
    if (mb && mb !== rev) {
      const probe = git("diff", "--name-only", `${mb}...${rev}`).trim();
      if (probe)
        return { base: mb, scope: "branch (merge-base with origin/main)" };
    }
  } catch {
    // origin/main may be missing; fall through to the parent diff.
  }
  return {
    base: git("rev-parse", `${rev}~1`).trim(),
    scope: "single commit (first parent)",
  };
}

const { base, scope } = resolveBase(target);

const files = git("diff", "--name-only", `${base}...${target}`)
  .split("\n")
  .filter(Boolean);
const numstat = git("diff", "--numstat", `${base}...${target}`)
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    const [add, del, file] = l.split("\t");
    return { file, add: Number(add) || 0, del: Number(del) || 0 };
  });

const totalChanged = numstat.reduce((a, n) => a + n.add + n.del, 0);
const overBudget = files.length > MAX_FILES || totalChanged > MAX_LINES;

/**
 * An empty diff would produce a packet describing a change that does not exist.
 * That reads as "reviewed, nothing found", which is the worst thing this script
 * could emit — so it fails loudly instead.
 */
if (files.length === 0) {
  console.error(
    `❌ ${short} has no diff against ${base.slice(0, 8)} — there is nothing to review.\n` +
      `   Pass a commit or branch that contains actual changes:\n` +
      `     pnpm review:prep -- --sha=<commit>\n`
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Acceptance criteria — the authoritative definition of done
// ---------------------------------------------------------------------------

const SPECS_DIR = join(ROOT, "specs");

/** Specs whose source or body mentions a changed file. */
function specsTouchedBy(changedFiles) {
  const specs = existsSync(SPECS_DIR)
    ? readdirSync(SPECS_DIR).filter((f) => f.endsWith(".md"))
    : [];
  const hits = [];
  for (const s of specs) {
    const text = readFileSync(join(SPECS_DIR, s), "utf-8");
    const relevant = changedFiles.some((f) => {
      const base = f.split("/").pop();
      // Match on basename so `src/lib/giphy.ts` matches a spec naming it in prose.
      return text.includes(f) || (base && text.includes(base));
    });
    if (relevant) hits.push({ file: `specs/${s}`, text });
  }
  return hits;
}

/** Extract `- [ ]` / `- [x]` acceptance criteria with their section context. */
function extractACs(text) {
  const out = [];
  let section = "";
  for (const line of text.split("\n")) {
    const h = line.match(/^#{2,3}\s+(.*)$/);
    if (h) section = h[1].trim();
    const ac = line.match(/^-\s+\[([ xX])\]\s+(.+)$/);
    if (ac)
      out.push({
        done: ac[1].toLowerCase() === "x",
        text: ac[2].trim(),
        section,
      });
  }
  return out;
}

const relevantSpecs = specsTouchedBy(files);
const allACs = relevantSpecs.flatMap((s) =>
  extractACs(s.text).map((ac) => ({ ...ac, spec: s.file }))
);

// Acceptance criteria a touched test claims to derive from, via `// spec:` refs.
const specRefs = new Set();
for (const f of files.filter((f) => /\.(ts|tsx)$/.test(f))) {
  const abs = join(ROOT, f);
  if (!existsSync(abs)) continue;
  for (const m of readFileSync(abs, "utf-8").matchAll(
    /\/\/\s*spec:\s*(?:specs\/)?([a-z0-9-]+\.spec\.md)/gi
  )) {
    specRefs.add(`specs/${m[1]}`);
  }
}

// ---------------------------------------------------------------------------
// Verify output — read, never re-run
// ---------------------------------------------------------------------------

/**
 * The implementer's own gate output, if it was captured.
 *
 * The reviewer is explicitly told not to re-run the suite: a full e2e run costs
 * ~4 minutes, and a reviewer that re-runs it every round is what made the
 * five-round spiral expensive. Re-running also risks the reviewer seeing a
 * *different* result and reasoning about a run the author never saw.
 *
 * `pnpm verify` does not tee to a file, so this looks for the artifacts the
 * checks leave behind and reports only what is verifiable without executing
 * anything.
 */
function gateEvidence() {
  const evidence = [];
  const has = (p) => existsSync(join(ROOT, p));

  evidence.push({
    check: "coverage integrity",
    status: has("coverage/coverage-final.json")
      ? "artifacts present"
      : "NOT RUN",
    detail: has("coverage/coverage-final.json")
      ? "re-run `pnpm run check:coverage-integrity` if you need the number"
      : "no coverage/coverage-final.json — coverage was not run",
  });
  evidence.push({
    check: "spec references / drift",
    status: "run on demand",
    detail: "`pnpm run check:spec-refs && pnpm run check:spec-drift`",
  });
  return evidence;
}

// ---------------------------------------------------------------------------
// Assemble
// ---------------------------------------------------------------------------

const unresolved = allACs.filter((a) => !a.done);

const lines = [];
const push = (...l) => lines.push(...l);

push(`# Review packet — ${short}`);
push("");
push(
  `> Generated by \`pnpm review:prep\`. Assemble-only: it runs no tests and makes`,
  `> no judgement. The review prompt is \`.opencode/agent/reviewer.md\`.`
);
push("");
push("## Change");
push("");
let subject = "";
try {
  subject = git("log", "-1", "--format=%s", target).trim();
} catch {
  subject = "(unknown)";
}
push(`**${short}** · ${subject}`);
push("");
push(`- base: \`${base.slice(0, 8)}\` (${scope})`);
push(
  `- ${files.length} file(s) changed · +${numstat.reduce((a, n) => a + n.add, 0)} −${numstat.reduce((a, n) => a + n.del, 0)}`
);
push("");
push("### Files");
push("");
for (const f of files) push(`- \`${f}\``);
push("");

if (overBudget) {
  push("## ⚠️ Over the review budget");
  push("");
  push(
    `This change is ${files.length} files / ${totalChanged} changed lines, against a budget of`,
    `${MAX_FILES} files / ${MAX_LINES} lines.`
  );
  push("");
  push(
    "A diff this size cannot be meaningfully reviewed — attention spreads thin and",
    "defects hide in the noise. The multi-round review spirals in this repo's history",
    "all happened against changes of exactly this shape."
  );
  push("");
  push(
    "**Decompose before reviewing**, not after. Split into changes small enough that",
    "one reviewer pass can hold all of it, then review each."
  );
  push("");
}

push("## Acceptance criteria (authoritative)");
push("");
if (allACs.length === 0) {
  push(
    "_No acceptance criteria found in the specs this change touches._",
    "",
    "That means there is no authoritative definition of done for this change, which is",
    'the condition that produced the "most of them false claims" reviews. Treat the',
    "spec as the gap, and check the change against its own stated intent only."
  );
} else {
  push(
    `_Extracted from the ${relevantSpecs.length} spec(s) this change touches. This list_`,
    `_**is** the definition of done — not the diff._`
  );
  push("");
  if (unresolved.length > 0) {
    push(`### Not yet satisfied (${unresolved.length})`);
    push("");
    for (const a of unresolved) {
      push(
        `- [ ] **${a.spec}** — ${a.text}${a.section ? ` _(under: ${a.section})_` : ""}`
      );
    }
    push("");
  }
  const done = allACs.filter((a) => a.done);
  if (done.length > 0) {
    push(`### Already marked done (${done.length})`);
    push("");
    for (const a of done) push(`- [x] **${a.spec}** — ${a.text}`);
    push("");
  }
  push(
    "> A criterion marked `[x]` is a claim by the author, not a verified fact. Check the",
    "> ones that matter most to this change rather than accepting all of them."
  );
}
push("");

push("## Specs the touched tests claim to derive from");
push("");
if (specRefs.size === 0) {
  push("_No `// spec:` references found in the changed test files._");
} else {
  for (const s of [...specRefs].sort()) push(`- \`${s}\``);
  push("");
  push(
    "_These links are machine-verified by `pnpm run check:spec-refs`; it confirms the"
  );
  push("reference resolves, not that the test asserts what the spec says._");
}
push("");

push("## Gate evidence");
push("");
push("_Read, not re-run. Re-running costs ~4 minutes per round._");
push("");
for (const e of gateEvidence()) {
  push(`- **${e.check}** — ${e.status}${e.detail ? ` · ${e.detail}` : ""}`);
}
push("");

push("## Reviewer rules");
push("");
push(
  "1. The acceptance criteria above are the definition of done. A finding not",
  "   traceable to a criterion, a stated invariant in a spec, or a security /",
  "   data-loss risk **is not a finding**.",
  "2. Do not propose new requirements. A spec gap is a separate issue, not a review",
  "   finding smuggled in here.",
  "3. Check that tests can fail. A test that cannot fail is worse than no test.",
  "4. Report `BLOCKER | MAJOR | MINOR`, each with `file:line`, the criterion it",
  "   violates, and a required disposition.",
  "5. If `review/<sha>.md` already lists rejected findings, do not re-raise one",
  "   without new evidence."
);
push("");
push("---");
push("");
push("## Diff");
push("");
push("```diff");
push(
  git("diff", `${base}...${target}`)
    .split("\n")
    .slice(0, 4000) // cap so the packet stays readable
    .join("\n")
);
push("```");

const outDir = join(ROOT, "review");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `${short}.md`);
writeFileSync(outPath, lines.join("\n") + "\n");

console.log(`✅ Review packet written to review/${short}.md`);
console.log(
  `   ${files.length} file(s) · ${allACs.length} acceptance criteria · ${specRefs.size} spec reference(s)`
);
if (overBudget) {
  console.log(
    `   ⚠️  OVER BUDGET (${files.length} files / ${totalChanged} lines vs ${MAX_FILES}/${MAX_LINES}) — decompose first`
  );
}
console.log(`   Next: hand review/${short}.md to a fresh reviewer agent.`);
