/**
 * Diagnostics toolkit E2E.
 *
 * Unit tests cover the pure report and the collector with stubbed sources. This
 * file covers the parts that only exist in a real extension: a seeded local
 * snapshot reaching the panel, a browser download containing redacted text,
 * live filtering of the debug log, and tab health against a real content
 * script.
 *
 * Selectors are testids first. Copy can change without invalidating a test.
 */

import fs from "fs";
import { test, expect } from "./fixtures.js";
import { waitForContentScriptReady } from "./helpers/content-script.js";
import { makeSnippets } from "./helpers/snippets.js";

async function openDiagnostics(optionsPage: import("@playwright/test").Page) {
  await optionsPage.getByTestId("options-nav-diagnostics").click();
  await expect(
    optionsPage.getByTestId("panel-diagnostics-toolkit")
  ).toBeVisible();
}

test("collects a snapshot and downloads a redacted report", async ({
  optionsPage,
  storageHelper,
}) => {
  const snippets = makeSnippets(1, () => ({
    id: "diag-1",
    label: "Signature",
    shortcut: "/sig",
  }));
  await storageHelper.seedSnippets(snippets);
  await storageHelper.setLocal("snippets", snippets);
  await storageHelper.setLocal("storageMode", "local");
  await storageHelper.setLocal("storageModeReason", "quota");
  await storageHelper.setLocal("debugMode", true);
  await storageHelper.setLocal("giphyApiKey", "private-key-must-not-export");
  await storageHelper.setLocal("syncDataLost", true);
  await storageHelper.setLocal("debugLog", [
    {
      ts: Date.parse("2026-01-02T03:04:05.000Z"),
      context: "content",
      event: "expand:no-match",
      detail: JSON.stringify({
        page: "https://example.com/private/path",
        text: "typed secret text",
        apiKey: "abcdef1234567890abcdef1234567890",
      }),
    },
  ]);

  await openDiagnostics(optionsPage);
  await optionsPage.getByTestId("button-collect-diagnostics").click();

  await expect(optionsPage.getByTestId("diag-storage-mode")).toContainText(
    "local"
  );
  await expect(optionsPage.getByTestId("diag-snippets")).toHaveText("1");
  await expect(optionsPage.getByTestId("diag-cached-snippets")).toHaveText("1");
  await expect(optionsPage.getByTestId("diag-log-entries")).toHaveText("1");
  await expect(optionsPage.getByTestId("diag-suspicious-events")).toHaveText(
    "1"
  );

  const [download] = await Promise.all([
    optionsPage.waitForEvent("download"),
    optionsPage.getByTestId("button-download-diagnostics").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^clipio-diagnostics-.*\.md$/);
  const path = await download.path();
  expect(path).not.toBeNull();
  const report = fs.readFileSync(path!, "utf8");

  expect(report).toContain("# Clipio diagnostics report");
  expect(report).toContain("- Mode: local (quota fallback)");
  expect(report).toContain("- Snippets: 1");
  expect(report).toContain("## Recent events (redacted)");
  expect(report).not.toContain("private-key-must-not-export");
  expect(report).not.toContain("typed secret text");
  expect(report).not.toContain("example.com/private/path");
  expect(report).not.toContain("abcdef1234567890abcdef1234567890");
});

test("filters the verbose log by context and query", async ({
  optionsPage,
  storageHelper,
}) => {
  const now = Date.now();
  await storageHelper.setLocal("debugMode", true);
  await storageHelper.setLocal("debugLog", [
    {
      ts: now - 2000,
      context: "content",
      event: "expand:match",
      detail: '{"shortcut":"/sig"}',
    },
    {
      ts: now - 1000,
      context: "background",
      event: "media:get",
      detail: "missing blob",
    },
  ]);

  await openDiagnostics(optionsPage);
  const log = optionsPage.getByTestId("debug-log");
  await expect(log).toContainText("expand:match");
  await expect(log).toContainText("media:get");
  await expect(optionsPage.getByTestId("debug-log-counts")).toContainText(
    "content=1, background=1, storage=0"
  );

  await optionsPage
    .getByTestId("debug-log-context-filter")
    .selectOption("background");
  await expect(log).toContainText("media:get");
  await expect(log).not.toContainText("expand:match");

  await optionsPage.getByTestId("debug-log-search").fill("no such event");
  await expect(log).toContainText("No entries match the current filter.");

  await optionsPage.getByTestId("debug-log-search").fill("MISSING BLOB");
  await expect(log).toContainText("media:get");
});

test("reports tab health against a live content script", async ({
  context,
  optionsPage,
}) => {
  const page = await context.newPage();
  await page.goto("http://localhost:7777/test-page.html");
  await waitForContentScriptReady(page);

  await openDiagnostics(optionsPage);
  await optionsPage.getByTestId("button-collect-diagnostics").click();

  await expect(optionsPage.getByTestId("diag-tab-health")).toContainText(
    "1 active"
  );
  await expect(optionsPage.getByTestId("diag-tab-health")).toContainText(
    "0 missing"
  );
  await page.close();
});
