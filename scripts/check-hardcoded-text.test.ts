/**
 * Tests for the shipped hardcoded-text matcher.
 *
 * The script is a CLI with no exports, so the matcher is loaded by source-slicing
 * rather than reimplemented here. These assertions exercise the same regexes,
 * allowlist and masking that `pnpm check:hardcoded-text` runs; a test-built
 * matcher would stay green while the gate stopped looking at a whole shape.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(process.cwd());
const SCRIPT = join(ROOT, "scripts/check-hardcoded-text.mjs");

type Finding = { file: string; line: number; text: string; kind: string };
type Checker = {
  scanSource: (content: string, rel: string) => Finding[];
  shouldScanFile: (name: string) => boolean;
};

function loadChecker(): Checker {
  const source = readFileSync(SCRIPT, "utf-8");
  // From the allowlist through scanSource: every dependency the matcher uses is
  // inside this span, and nothing at module scope runs a filesystem walk.
  const start = source.indexOf("const ALLOWLIST = [");
  const end = source.indexOf("function walk(dir, out = [])");
  expect(start, "ALLOWLIST not found in the script").toBeGreaterThan(-1);
  expect(end, "end of scanSource not found").toBeGreaterThan(start);
  const body = source.slice(start, end);
  return new Function(
    `${body}\nreturn { scanSource, shouldScanFile };`
  )() as Checker;
}

const checker = loadChecker();

/** The reported text, in report order, for a source fixture. */
const texts = (content: string, rel = "Fixture.tsx") =>
  checker.scanSource(content, rel).map((finding) => finding.text);

describe("check-hardcoded-text", () => {
  it("passes on the shipped src tree", () => {
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it("finds literal JSX text but not a translated expression", () => {
    expect(texts("<p>Delete all snippets</p>")).toEqual([
      "Delete all snippets",
    ]);
    // The negative case comes from the shipped matcher: a locally written
    // parser could agree that braces mean interpolation without proving it.
    expect(texts('<p>{i18n.t("dashboard.delete")}</p>')).toEqual([]);
  });

  it("keeps line numbers true after comments are blanked", () => {
    const [finding] = checker.scanSource(
      "// a comment\n\n<p>Delete all snippets</p>",
      "Fixture.tsx"
    );
    expect(finding?.line).toBe(3);
  });

  it("finds alt text and leaves allowlisted brand alt text alone", () => {
    expect(texts('<img alt="Snippet preview thumbnail" />')).toEqual([
      "Snippet preview thumbnail",
    ]);
    expect(texts('<img alt="Clipio" />')).toEqual([]);
    expect(texts('<img alt={i18n.t("preview.thumbnailAlt")} />')).toEqual([]);
  });

  it("finds long accessible labels past the old 60-character cap", () => {
    const long =
      "This tooltip is deliberately long enough to pass the old sixty-character limit and is still hardcoded";
    expect(long.length).toBeGreaterThan(60);
    expect(texts(`<button title="${long}">x</button>`)).toEqual([long]);
    expect(texts('<button title={i18n.t("long.tooltip")}>x</button>')).toEqual(
      []
    );
  });

  it("finds direct string literals in accessible-name expressions", () => {
    const findings = checker.scanSource(
      `<div title={"Delete all snippets"} aria-label={"Open options"}>
         <input placeholder={'Search snippets...'} />
         <img alt={"Snippet preview"} />
       </div>`,
      "Fixture.tsx"
    );
    expect(findings.map((finding) => finding.kind).sort()).toEqual([
      "alt",
      "aria-label",
      "placeholder",
      "title",
    ]);
    expect(findings.map((finding) => finding.text)).toEqual(
      expect.arrayContaining([
        "Delete all snippets",
        "Open options",
        "Search snippets...",
        "Snippet preview",
      ])
    );
  });

  it("does not mistake dynamic or test-id expressions for accessible names", () => {
    const source = `<div
        title={i18n.t("a.title")}
        aria-label={label}
        placeholder={cn("Search snippets...")}
        data-testid={"delete-button"}
      />`;
    expect(texts(source)).toEqual([]);
  });

  it("finds hardcoded DOM text, including fallbacks", () => {
    const source = `label.textContent = "No snippets found";
      hint.textContent = "Type a shortcut to create one";
      title.textContent = titleText || "Untitled snippet";`;
    expect(texts(source, "Fixture.ts")).toEqual([
      "No snippets found",
      "Type a shortcut to create one",
      "Untitled snippet",
    ]);
  });

  it("leaves translated DOM text alone", () => {
    const source = `label.textContent = i18n.t("dashboard.noSnippetsFound");
      title.textContent = titleText || i18n.t("snippetEditor.namePlaceholder");`;
    expect(texts(source, "Fixture.ts")).toEqual([]);
  });

  it("finds hardcoded accessible attributes written from .ts", () => {
    const source = `list.setAttribute("aria-label", "Snippet suggestions");
      logo.alt = "Clipio preview";`;
    expect(texts(source, "Fixture.ts")).toEqual([
      "Clipio preview",
      "Snippet suggestions",
    ]);
  });

  it("ignores non-accessibility attributes and allowlisted alts in .ts", () => {
    const source = `list.setAttribute("data-testid", "preview-list");
      logo.alt = "Clipio";`;
    expect(texts(source, "Fixture.ts")).toEqual([]);
  });

  it("finds hardcoded browser menu and notification options", () => {
    const source = `browser.contextMenus.create({ id: "parent", title: "Clipio: Snippets Manager" });
      browser.notifications.create({ message: "Update available" });`;
    expect(texts(source, "Fixture.ts")).toEqual([
      "Clipio: Snippets Manager",
      "Update available",
    ]);
  });

  it("leaves console, telemetry, Error messages and locale keys alone", () => {
    // Each call has capitalised prose that would be reported if the masking
    // stopped working. These are operator diagnostics, not user-facing copy.
    const source = `console.error("Failed to load snippets:", error);
      captureMessage("Sync storage wipe detected", "warning");
      captureError(err, { action: "x" });
      debugLog("background", "update:check:start", {});
      throw new Error("FileReader failed to read the blob");
      i18n.t("background.reviewPrompt.title");`;
    expect(texts(source, "Fixture.ts")).toEqual([]);
  });

  it("does not read an Error fallback's message property as UI copy", () => {
    const source = `const wrapped = new GiphyNetworkError(
        err instanceof Error ? err.message : "Unknown network error"
      );`;
    expect(texts(source, "Fixture.ts")).toEqual([]);
  });

  it("ignores prose inside comments", () => {
    const source = `// title="Do not translate this"
      /* alt="Nor this" */
      <div />`;
    expect(texts(source)).toEqual([]);
  });

  it("excludes test fixtures and declaration files from the walk", () => {
    expect(checker.shouldScanFile("Fixture.test.ts")).toBe(false);
    expect(checker.shouldScanFile("Fixture.test.tsx")).toBe(false);
    expect(checker.shouldScanFile("types.d.ts")).toBe(false);
    expect(checker.shouldScanFile("Fixture.ts")).toBe(true);
    expect(checker.shouldScanFile("Fixture.tsx")).toBe(true);
  });
});
