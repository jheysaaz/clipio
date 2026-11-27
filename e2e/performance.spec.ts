/**
 * Popup performance regression tests.
 *
 * These run against the real extension in Chromium with a seeded library. The
 * 520-row case covers a large hand-testable library; the 5,000-row case proves
 * the popup scales with the library instead of with a hard-coded fixture size.
 *
 * The app writes two marks: `clipio:popup-shell` on the first Dashboard commit
 * and `clipio:library-ready` when the list is populated. Both are measured from
 * navigation start, so the assertions are about what the user waits for, not
 * about Playwright's own round-trips.
 */

import { expect, test } from "./fixtures.js";

type SnippetSeed = {
  id: string;
  label: string;
  shortcut: string;
  content: string;
  tags: string[];
  usageCount: number;
  createdAt: string;
  updatedAt: string;
  rev: number;
  updatedBy: string;
};

/**
 * A representative library, generated in-test so the baseline needs no
 * untracked fixture. The count is the only property the timing depends on.
 */
function library(size: number): SnippetSeed[] {
  return Array.from({ length: size }, (_, index) => makeSeed(index));
}

function makeSeed(index: number): SnippetSeed {
  const n = String(index).padStart(4, "0");
  return {
    id: `perf-${n}`,
    label: `Snippet ${n}`,
    shortcut: `;p${n}`,
    content: `Body for snippet ${n}\n{{cursor}}\nA short paragraph used to exercise the sidebar preview.`,
    tags: ["perf", "bulk"],
    usageCount: index,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: `2025-01-01T00:${String(index % 60).padStart(2, "0")}:00.000Z`,
    rev: 1,
    updatedBy: "perf-writer",
  };
}

async function seedLocal(
  context: import("@playwright/test").BrowserContext,
  extensionId: string,
  snippets: SnippetSeed[]
) {
  const setup = await context.newPage();
  await setup.goto(`chrome-extension://${extensionId}/popup.html`);
  await setup.evaluate(async (items) => {
    const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
    await ext.storage.local.set({
      storageMode: "local",
      storageModeReason: "manual",
      snippets: items,
      cachedSnippets: items,
    });
  }, snippets);
  await setup.close();
}

async function marks(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const last = (name: string) => {
      const entries = performance.getEntriesByName(name);
      return entries.length ? entries[entries.length - 1]!.startTime : null;
    };
    return {
      shell: last("clipio:popup-shell"),
      library: last("clipio:library-ready"),
    };
  });
}

async function assertFastPopup(
  context: import("@playwright/test").BrowserContext,
  extensionId: string,
  snippets: SnippetSeed[]
) {
  await seedLocal(context, extensionId, snippets);

  const page = await context.newPage();
  const startedAt = Date.now();
  await page.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: "commit",
  });
  await page.waitForSelector('[data-testid="snippet-list"]', {
    timeout: 30_000,
  });
  // The mark is written from the app on the first commit after the read settles,
  // so poll it rather than relying on the waitForSelector round-trip.
  await expect
    .poll(async () => (await marks(page)).library, {
      message: "popup never marked the library ready",
    })
    .not.toBeNull();

  const timings = await marks(page);
  expect(timings.shell).not.toBeNull();
  expect(timings.shell!).toBeLessThan(1_000);
  expect(timings.library!).toBeLessThan(3_000);

  const rows = await page.getByTestId("snippet-list-item").count();
  // Windowed list: only the viewport and its overscan are in the DOM.
  expect(rows).toBeGreaterThan(0);
  expect(rows).toBeLessThan(100);

  const last = snippets[snippets.length - 1]!;
  await page.getByTestId("snippet-search").fill(last.label);
  await expect(page.getByTestId("snippet-list-item")).toHaveCount(1);
  await expect(page.getByTestId("snippet-list-item")).toContainText(last.label);
  expect(Date.now() - startedAt).toBeLessThan(3_000);

  console.log(
    `PERF ${snippets.length}: shell=${Math.round(timings.shell!)}ms ` +
      `library=${Math.round(timings.library!)}ms ` +
      `searchDone=${Date.now() - startedAt}ms renderedRows=${rows}`
  );
  await page.close();
}

test("popup opens and loads a 520-snippet library fast", async ({
  context,
  extensionId,
}) => {
  await assertFastPopup(context, extensionId, library(520));
});

test("popup stays fast with 5,000 snippets", async ({
  context,
  extensionId,
}) => {
  await assertFastPopup(context, extensionId, library(5_000));
});
