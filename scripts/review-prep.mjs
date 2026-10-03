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

/**
 * Diff size cap for the packet.
 *
 * A packet is meant to be read, so it cannot hold an unbounded diff. But any cap
 * must be announced: see `pushDiff`, which names every withheld file.
 */
const DIFF_LINE_CAP = 4000;

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

/**
 * Which specs are authoritative for this change.
 *
 * A spec contributes criteria only if a module it DECLARES AS ITS SOURCE changed.
 * That declaration is the `> Source:` header, which names the module the spec is
 * about.
 *
 * The earlier rule — "any spec whose text mentions a changed file's basename" —
 * produced a transitive closure, because the changed file list itself contains
 * spec `.md` files. One commit that touched `specs/blocked-sites.spec.md` (and
 * that spec happens to mention `content-script-trust.spec.md` in prose) pulled in
 * every spec reachable by a mention-chain. On the first real run, 51 of the 59
 * "authoritative" criteria were about modules the change never touched, and the
 * 8 that mattered were buried among them.
 *
 * Since these criteria become the reviewer's entire authority (see rule 1 in
 * `.opencode/agent/reviewer.md`), noise here is not cosmetic — it actively
 * misdirects the review. Specs the commit merely EDITED are reported separately,
 * as edits, not as sources of requirements.
 *
 * @param {string[]} changedFiles all changed paths
 * @returns {{ authoritative: Array, edited: string[] }}
 */
function relevantSpecs(changedFiles) {
  const changedCode = changedFiles.filter(
    (f) => !f.startsWith("specs/") && /\.(ts|tsx)$/.test(f)
  );
  const editedSpecs = changedFiles.filter((f) => f.startsWith("specs/"));

  const specs = existsSync(SPECS_DIR)
    ? readdirSync(SPECS_DIR).filter((f) => f.endsWith(".md"))
    : [];

  const authoritative = [];
  for (const s of specs) {
    const rel = `specs/${s}`;
    const text = readFileSync(join(SPECS_DIR, s), "utf-8");
    const sources = declaredSources(text);

    // Relevant only when a module it declares as its subject actually changed.
    if (sources.some((src) => changedCode.includes(src))) {
      authoritative.push({ file: rel, text });
    }
  }
  return { authoritative, editedSpecs };
}

/** Paths named in a spec's `> Source:` headers (all lines, all backticked tokens). */
function declaredSources(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^>\s*Source:\s*(.*)$/);
    if (!m) continue;
    for (const t of m[1].matchAll(/`([^`]+)`/g)) {
      const p = t[1].trim();
      // Only concrete source paths; skip directories and globs, and skip the
      // parenthetical symbol lists.
      if (/^(src|e2e)\//.test(p) && !p.includes("*") && !p.endsWith("/")) {
        out.push(p);
      }
    }
  }
  return out;
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

const { authoritative, editedSpecs } = relevantSpecs(files);
const allACs = authoritative.flatMap((s) =>
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
let subject;
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
    `_Extracted from the ${authoritative.length} spec(s) whose declared source module this change`,
    `_alters. This list_ **_is** the definition of done — not the diff._`,
    "",
    `_Only specs that declare a changed module as their source are included. Specs the change`,
    `_merely edited are listed separately below and contribute no criteria._`
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

if (editedSpecs.length > 0) {
  push("## Specs edited by this change");
  push("");
  push(
    "_Listed for awareness. These contribute NO acceptance criteria above — editing a"
  );
  push(
    "spec is not the same as changing the module it describes, and treating it as"
  );
  push("authoritative is what made an earlier packet 51-of-59 noise._");
  push("");
  for (const s of editedSpecs) push(`- \`${s}\``);
  push("");
}

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

/**
 * Emit the diff, or say exactly what was withheld.
 *
 * The diff is capped so the packet stays readable, but the cap is stated out
 * loud and every omitted file is named. An earlier version truncated silently:
 * a 6829-line diff was cut at 4000, 30 of 48 files never reached the reviewer,
 * and nothing in the packet said so. The files withheld included
 * `scripts/verify.mjs` — the gate itself — so the reviewer could not tell that
 * the thing they were reviewing was not in front of them. Silent truncation in
 * a tool whose entire purpose is to make review honest is the worst failure it
 * could have.
 *
 */
function pushDiff() {
  const raw = git("diff", `${base}...${target}`);
  const lines = raw.split("\n");

  if (lines.length <= DIFF_LINE_CAP) {
    push("```diff");
    push(raw);
    push("```");
    return;
  }

  // Emit whole-file hunks only. Cutting mid-hunk produces a patch that will not
  // apply and a file that looks complete when it is not.
  const kept = [];
  let currentFile = null;
  let omitted = [];

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const m = line.match(/ b\/(.+)$/);
      currentFile = m ? m[1] : "(unknown)";
    }
    if (kept.length >= DIFF_LINE_CAP) {
      if (currentFile && !omitted.includes(currentFile))
        omitted.push(currentFile);
      continue;
    }
    kept.push(line);
  }

  // Roll back to the last complete file boundary so no hunk is cut in half.
  while (kept.length > 0 && !kept[kept.length - 1].startsWith("diff --git ")) {
    const lastFileHeader = kept.findLastIndex((l) =>
      l.startsWith("diff --git ")
    );
    if (lastFileHeader === -1) break;
    const m = kept[lastFileHeader].match(/ b\/(.+)$/);
    const file = m ? m[1] : "(unknown)";
    kept.length = lastFileHeader;
    if (!omitted.includes(file)) omitted.push(file);
  }

  push(
    `> ⚠️ **Diff truncated: ${lines.length} lines total, showing ${kept.length}.**`,
    `> **${omitted.length} file(s) are NOT in this packet:**`,
    ""
  );
  for (const f of omitted) push(`> - \`${f}\``);
  push(
    "",
    "> Read them directly with `git show <sha> -- <path>`. A file absent from",
    "> this packet has NOT been reviewed — do not treat this as an approval of",
    "> anything in the list above."
  );
  push("");
  push("```diff");
  push(kept.join("\n"));
  push("```");
}

pushDiff();

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
