/**
 * Tests for `scripts/check-coverage-integrity.mjs`'s glob matcher.
 *
 * WHY THIS EXISTS
 *
 * The matcher was originally a string-replacement scheme that swapped `**` for a
 * NUL sentinel and back again. That embedded a literal 0x00 byte in the file, so
 * git stored it as binary and the script was invisible to code review.
 *
 * Replacing it with a segment-wise compiler immediately introduced two silent
 * failures, both of which made the gate fail on a healthy run or pass on a
 * broken one:
 *
 *   1. A trailing glob-star compiled to `^src/hooks/(?:[^/]+/)+$` — i.e. it required
 *      at least one nested directory — which cannot match `src/hooks/FontContext.tsx`,
 *      so every file under an excluded directory
 *      was reported missing. 67 phantom failures.
 *   2. A middle `**` mishandled its adjacent separator in both directions:
 *      `src/<star>/x` became `src/<star>//x` and `src/x/<star>` became `srcx`.
 *      Both forms occur in this config's exclude list, so the `d.ts` and `__mocks__` glob
 *      patterns excluded nothing.
 *
 * Neither was caught by running the script, because the count it produced still
 * looked plausible. These cases pin the semantics directly.
 *
 * The function is loaded out of the script by source-slicing rather than being
 * imported, because the script executes its checks at module scope and has no
 * exports. Slicing keeps the test honest — it exercises the shipped code, not a
 * re-implementation.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

// Resolved from the project root rather than from this file's own directory.
// Under Vitest's transform `__dirname` points at the project root and
// `import.meta.url` is not a `file:` URL, so neither can be used to locate the
// script; `process.cwd()` is the one root Vitest reliably sets.
const SCRIPT = resolve(process.cwd(), "scripts/check-coverage-integrity.mjs");

/** Load the real `isExcluded` out of the script, bound to a pattern list. */
function loadIsExcluded(patterns: string[]): (path: string) => boolean {
  const source = readFileSync(SCRIPT, "utf-8");
  const start = source.indexOf("function isExcluded");
  const end = source.indexOf("const intended");
  expect(start, "isExcluded not found in the script").toBeGreaterThan(-1);
  expect(end, "end of isExcluded not found").toBeGreaterThan(start);
  const body = source.slice(start, end);
  // `new Function` is deliberate: the script has no exports and runs its checks
  // at module scope, so source-slicing is the only way to exercise the shipped
  // compiler rather than a copy of it.
  return new Function("excludePatterns", `${body}\nreturn isExcluded;`)(
    patterns
  );
}

/**
 * Ask the shipped compiler whether `path` matches `pattern`.
 *
 * `isExcluded` closes over a module-level `excludePatterns`, so the test loads a
 * fresh copy bound to a single-element list per assertion rather than
 * re-implementing the glob compiler here — which is exactly the mistake rule 1
 * warns about.
 */
const excluded = (pattern: string, path: string) =>
  loadIsExcluded([pattern])(path);

describe("isExcluded — trailing glob-star", () => {
  it("excludes a file directly inside the directory", () => {
    expect(excluded("src/hooks/**", "src/hooks/FontContext.tsx")).toBe(true);
  });

  it("excludes the directory itself", () => {
    expect(excluded("src/hooks/**", "src/hooks")).toBe(true);
  });

  it("excludes a file nested several levels deep", () => {
    expect(excluded("src/hooks/**", "src/hooks/a/b/c/Thing.ts")).toBe(true);
  });

  it("does not exclude a sibling whose name merely starts the same", () => {
    // The `**` must respect the directory boundary.
    expect(excluded("src/hooks/**", "src/hooksy/Foo.ts")).toBe(false);
  });

  it("excludes a directory with no files of its own", () => {
    expect(excluded("src/config/**", "src/config/constants.ts")).toBe(true);
  });
});

describe("isExcluded — middle glob-star", () => {
  it("matches with zero intervening segments", () => {
    // Regression: `src/<star>/.d.ts` used to compile to `src<star>…`, which
    // required at least one directory and so missed every `.d.ts` at depth 1.
    expect(excluded("src/**/*.d.ts", "src/wxt.d.ts")).toBe(true);
  });

  it("matches with one intervening segment", () => {
    expect(excluded("src/**/*.d.ts", "src/types/index.d.ts")).toBe(true);
  });

  it("matches with several intervening segments", () => {
    expect(excluded("src/**/*.d.ts", "src/a/b/c/thing.d.ts")).toBe(true);
  });

  it("does not match a path without the suffix", () => {
    expect(excluded("src/**/*.d.ts", "src/index.ts")).toBe(false);
  });

  it("matches a glob-star followed by a literal segment", () => {
    // Regression: `src/<star>__mocks__/**` compiled with a doubled separator.
    expect(excluded("src/**/__mocks__/**", "src/lib/__mocks__/x.ts")).toBe(
      true
    );
  });

  it("does not match a near-miss directory name", () => {
    expect(excluded("src/**/__mocks__/**", "src/lib/notmocks/x.ts")).toBe(
      false
    );
  });
});

describe("isExcluded — single-segment wildcard", () => {
  it("matches any characters within one segment", () => {
    expect(excluded("src/**/*.ts", "src/lib/markdown.ts")).toBe(true);
  });

  it("does not cross a segment boundary", () => {
    expect(excluded("src/*.ts", "src/lib/markdown.ts")).toBe(false);
  });
});

describe("isExcluded — exact paths", () => {
  it("excludes the exact file", () => {
    expect(excluded("src/lib/sentry.ts", "src/lib/sentry.ts")).toBe(true);
  });

  it("does not exclude a file sharing a prefix", () => {
    expect(excluded("src/lib/sentry.ts", "src/lib/sentryX.ts")).toBe(false);
  });
});

describe("every glob shape actually present in vitest.config.ts", () => {
  const patterns: Array<[string, string, boolean]> = [
    // Straight from `coverage.exclude`.
    ["src/entrypoints/**", "src/entrypoints/background.ts", true],
    ["src/components/ui/**", "src/components/ui/button.tsx", true],
    [
      "src/components/editor/placeholders/**",
      "src/components/editor/placeholders/a/b.tsx",
      true,
    ],
    ["src/assets/**", "src/assets/styles/fonts.css", true],
    ["src/**/*.d.ts", "src/types/index.d.ts", true],
    ["src/**/__mocks__/**", "src/lib/__mocks__/x.ts", true],
    ["src/pages/**", "src/pages/Dashboard.tsx", true],
    ["src/config/**", "src/config/constants.ts", true],
    [
      "src/components/editor/RichTextEditor.tsx",
      "src/components/editor/RichTextEditor.tsx",
      true,
    ],
    ["src/app.css", "src/app.css", true],
    ["src/lib/sentry.ts", "src/lib/sentry.ts", true],
    ["src/lib/utils.ts", "src/lib/utils.ts", true],
    ["src/storage/index.ts", "src/storage/index.ts", true],
    // Paths the config does NOT exclude, so an over-broad glob fails here.
    ["src/components/ui/**", "src/components/ConfirmDialog.tsx", false],
    ["src/lib/sentry.ts", "src/lib/markdown.ts", false],
    ["src/pages/**", "src/lib/markdown.ts", false],
  ];

  it.each(patterns)("%s vs %s → %s", (pattern, path, expected) => {
    expect(excluded(pattern, path)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Exclude extraction
// ---------------------------------------------------------------------------

/**
 * Extract the exclude patterns from a config body, using the shipped logic.
 *
 * The same source-slicing approach as `loadIsExcluded`: the point is to test the
 * code that runs in the gate, not a re-implementation of it.
 */
function extractExcludes(configBody: string): string[] {
  const source = readFileSync(SCRIPT, "utf-8");
  const start = source.indexOf("const excludeMatch");
  const end = source.indexOf("if (includeGlobs.length");
  expect(start, "exclude extraction not found in the script").toBeGreaterThan(
    -1
  );
  expect(end).toBeGreaterThan(start);
  const body = source.slice(start, end);
  // Shaped like a `String.match` result — `[fullMatch, firstCaptureGroup]` — so
  // `coverageBlock[1]` is the coverage block's body, which is what the script
  // reads. An object at index 0 would leave `[1]` undefined.
  const coverageBlock = [configBody, configBody];
  return new Function("coverageBlock", `${body}\nreturn excludePatterns;`)(
    coverageBlock
  ) as string[];
}

describe("exclude extraction — comments", () => {
  it("ignores a comment containing a straight double quote", () => {
    // The bug this guards. The extractor is a naive quote-delimited regex, so a
    // `"` in prose inside the exclude block opened a string that swallowed every
    // real exclude after it. The gate then reported 31 excluded files as
    // configured-and-missing — red for a reason unrelated to coverage.
    //
    // Found because an ordinary explanatory comment used a quoted phrase. The
    // existing comments had simply avoided the character, which is why it lay
    // undiscovered.
    const patterns = extractExcludes(`
      exclude: [
        // A comment with a quoted phrase: "worse than a longer list".
        "src/hooks/**",
        // Another comment.
        "src/pages/**",
      ]
    `);

    expect(patterns).toEqual(["src/hooks/**", "src/pages/**"]);
  });

  it("ignores comment lines that mention exclude paths", () => {
    const patterns = extractExcludes(`
      exclude: [
        // NOTE: src/hooks/** used to be excluded here; the directory is gone.
        "src/config/**",
      ]
    `);

    expect(patterns).toEqual(["src/config/**"]);
  });

  it("still reads backtick and single-quoted patterns", () => {
    const patterns = extractExcludes(`
      exclude: [
        \`src/a/**\`,
        'src/b/**',
      ]
    `);

    expect(patterns).toEqual(["src/a/**", "src/b/**"]);
  });
});

describe("exclude extraction — the real config", () => {
  it("recovers every exclude the repo actually intends", () => {
    // Direct guard on the live file: a comment carrying a quote must never be
    // able to swallow these again.
    const config = readFileSync(
      resolve(process.cwd(), "vitest.config.ts"),
      "utf-8"
    );
    const coverageBlock = config.match(/coverage:\s*\{([\s\S]*?)\n {4}\}/);
    expect(coverageBlock, "coverage block not found").not.toBeNull();

    const patterns = extractExcludes(coverageBlock![1]);

    for (const expected of [
      "src/entrypoints/**",
      "src/components/ui/**",
      "src/pages/**",
      "src/config/**",
    ]) {
      expect(patterns, expected).toContain(expected);
    }

    // These two used to be excluded while their tests were built. Keeping the
    // negative assertions here makes a silent re-exclusion fail the gate.
    for (const removed of [
      "src/components/options/**",
      "src/storage/backends/indexeddb.ts",
    ]) {
      expect(patterns, removed).not.toContain(removed);
    }
  });

  it("yields no path that came from a comment", () => {
    // Every extracted pattern is either a real glob or an exact source path. A
    // multi-line blob spanning comment prose is the signature of the old bug.
    const config = readFileSync(
      resolve(process.cwd(), "vitest.config.ts"),
      "utf-8"
    );
    const coverageBlock = config.match(/coverage:\s*\{([\s\S]*?)\n {4}\}/);
    const patterns = extractExcludes(coverageBlock![1]);

    for (const pattern of patterns) {
      expect(pattern, pattern).not.toContain("//");
      expect(pattern, pattern).not.toContain("\n");
      expect(pattern, pattern).not.toContain("  ");
    }
  });
});
