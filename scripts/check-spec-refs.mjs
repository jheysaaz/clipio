/**
 * Spec reference gate.
 *
 * WHY THIS EXISTS
 *
 * AGENTS.md Testing Standards rule 10 says: "prefer spec-derived tests
 * (`specs/*.spec.md` → `// spec:` comments)". Measured across the repo, that
 * convention was almost entirely decorative:
 *
 *     505  total `// spec:` comments
 *      52  name a spec FILE
 *       2  name a spec file AND an anchor
 *     182  are literally `// spec: MUST`
 *
 * So 1% of spec references were machine-checkable — and of the 38 that were,
 * three were already dead links:
 *
 *     specs/developers-section.spec.md#debug-mode
 *     specs/importers.spec.md#detect
 *     specs/preview-anchor.spec.md#get
 *
 * A dead anchor is worse than no link: it asserts a traceability that does not
 * exist, and renaming a heading silently breaks it with nothing to notice.
 *
 * WHAT THIS CHECKS
 *
 * Any `// spec: <path>[#anchor]` comment where `<path>` looks like a spec file
 * must resolve:
 *
 *   1. the file exists
 *   2. the anchor (if given) matches a heading in that file
 *
 * Free-form prose like `// spec: MUST strip the marker` is deliberately NOT
 * checked — there is nothing to resolve, and inventing a rule for it would
 * produce false failures. The goal is to keep real links honest, not to force
 * every comment into a shape.
 *
 * Exit codes: 0 clean, 1 dead reference(s), 2 bad usage.
 *
 * Usage: pnpm check:spec-refs   (run automatically by `pnpm verify`)
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { dirname, join, relative, resolve, sep } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SPECS_DIR = join(ROOT, "specs");

/**
 * Files scanned for `// spec:` comments. Deliberately the same two trees the
 * test suite lives in — this is a traceability check between specs and tests,
 * so scanning source that cannot contain tests would only add noise.
 */
const SCAN_ROOTS = ["src", "e2e"];

const posix = (p) => p.split(sep).join("/");

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === "node_modules" || entry === "dist") continue;
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

/**
 * GitHub-style heading slug.
 *
 * GitHub's algorithm: lowercase, drop everything that is not a word character,
 * whitespace or a hyphen, then turn EACH remaining space into a hyphen — it does
 * not collapse runs. That distinction is load-bearing: a heading reading
 * `Behavior when \`asHtml === true\`` keeps three spaces around the stripped
 * punctuation and therefore slugs to `behavior-when-ashtml--true` with a DOUBLE
 * hyphen. Collapsing whitespace to a single hyphen here would silently disagree
 * with every anchor a developer writes by hand from a GitHub URL bar.
 *
 * Backticks are treated as punctuation (dropped, like any other non-word
 * character) but the whitespace they surround is preserved, matching GitHub.
 */
const slug = (heading) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/ /g, "-");

/** Anchor set for a spec file, from its ATX headings. */
function anchorsOf(specPath) {
  const body = readFileSync(specPath, "utf-8");
  const anchors = new Set();
  let inFence = false;
  for (const line of body.split("\n")) {
    // Headings inside a fenced block are example content, not structure.
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(/^#{1,6}\s+(.*)$/);
    if (m) {
      const s = slug(m[1]);
      anchors.add(s);
      // GitHub also emits a `-1`, `-2`, … suffix for duplicate headings.
      for (let i = 2; i < 20; i++) anchors.add(`${s}-${i}`);
    }
  }
  return anchors;
}

// ---------------------------------------------------------------------------
// Collect references
// ---------------------------------------------------------------------------

const specFiles = new Set(
  readdirSync(SPECS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => `specs/${f}`)
);

const anchorCache = new Map();
function anchorsFor(specRel) {
  if (!anchorCache.has(specRel)) {
    anchorCache.set(specRel, anchorsOf(join(ROOT, specRel)));
  }
  return anchorCache.get(specRel);
}

const problems = [];
let checked = 0;
let fileLinks = 0;

/**
 * Match `// spec: …` comments that carry a spec *path*.
 *
 * Accepts both forms in use in this repo:
 *     // spec: specs/foo.spec.md#anchor
 *     // spec: foo.spec.md#anchor          (bare filename)
 */
const REF =
  /\/\/\s*spec:\s*(?:specs\/)?([a-z0-9-]+\.spec\.md)(#([a-z0-9-]+))?/gi;

for (const scanRoot of SCAN_ROOTS) {
  const abs = join(ROOT, scanRoot);
  if (!existsSync(abs)) continue;

  for (const file of walk(abs)) {
    const rel = posix(relative(ROOT, file));
    const lines = readFileSync(file, "utf-8").split("\n");

    lines.forEach((line, i) => {
      const m = line.match(/\/\/\s*spec:\s*(.+)$/);
      if (!m) return;
      const tail = m[1];
      const refMatch = tail.match(
        /^(?:specs\/)?([a-z0-9-]+\.spec\.md)(?:#([a-z0-9-]+))?/i
      );
      // Not a file reference — free-form prose such as `// spec: MUST …`.
      if (!refMatch) return;

      checked++;
      fileLinks++;

      const [, name, anchor] = refMatch;
      const candidates = [`specs/${name}`, name];
      const specRel = candidates.find((c) => specFiles.has(c));

      if (!specRel) {
        // Distinguish "typo'd filename" from "no such spec at all" — the fix
        // is different.
        const near = [...specFiles].filter((s) =>
          s
            .replace(/\.spec\.md$/, "")
            .startsWith(name.replace(/\.spec\.md$/, "").slice(0, 6))
        );
        problems.push({
          rel,
          line: i + 1,
          text: line.trim(),
          reason: `no spec file named \`${name}\` in specs/`,
          hint: near.length
            ? `did you mean ${near.map((n) => `\`${n}\``).join(", ")}?`
            : null,
        });
        return;
      }

      if (anchor) {
        const anchors = anchorsFor(specRel);
        if (!anchors.has(anchor.toLowerCase())) {
          problems.push({
            rel,
            line: i + 1,
            text: line.trim(),
            reason: `\`${specRel}\` has no heading matching anchor \`#${anchor}\``,
            hint: nearestAnchor(anchors, anchor),
          });
        }
      }
    });
  }
}

/** Closest heading slug, to make a broken anchor actionable rather than vague. */
function nearestAnchor(anchors, target) {
  const bare = [...anchors].filter((a) => !/-\d+$/.test(a));
  let best = null;
  let bestScore = Infinity;
  for (const a of bare) {
    const score = levenshtein(a, target);
    if (score < bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best && bestScore <= Math.max(3, Math.floor(target.length / 3))
    ? `did you mean \`#${best}\`?`
    : null;
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return d[m][n];
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (problems.length === 0) {
  console.log(
    `✅ Spec references: ${fileLinks} file link(s) across src/ and e2e/ all resolve`
  );
  console.log(
    `   (${checked} checked · free-form \`// spec:\` prose is not machine-checkable and is not checked)`
  );
  process.exit(0);
}

console.error(`\n❌ Spec references: ${problems.length} dead reference(s)\n`);
for (const p of problems) {
  console.error(`   ${p.rel}:${p.line}`);
  console.error(`     ${p.text}`);
  console.error(`     → ${p.reason}`);
  if (p.hint) console.error(`     → ${p.hint}`);
  console.error("");
}
console.error(
  `   A dead spec link asserts traceability that does not exist, and renaming a\n` +
    `   heading breaks it silently. Fix the reference, or fix the heading.\n`
);
process.exit(1);
