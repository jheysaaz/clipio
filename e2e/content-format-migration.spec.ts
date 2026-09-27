/**
 * Legacy `contentFormat: "html"` snippets.
 * spec: specs/content-format-migration.spec.md
 *
 * The corruption this covers: the editor always serialised markdown, while the
 * flag was carried forward onto the markdown body. So a snippet labelled
 * "html" was written as markdown, and the *next* open ran the markdown source
 * through DOMParser as text/html — collapsing it to one text blob and
 * destroying every line break. Two round trips, silently mangled.
 */

import { test, expect } from "./fixtures.js";
import { makeSnippet } from "./helpers/snippets.js";
import { waitForContentScriptReady } from "./helpers/content-script.js";
import type { StorageHelper } from "./fixtures.js";

/** A snippet as Clipio 1.x would have written it: HTML body, flag set. */
function legacyHtmlSnippet(id: string, shortcut: string, content: string) {
  return {
    ...makeSnippet({ id, label: "Legacy HTML", shortcut, content }),
    contentFormat: "html",
  } as unknown as ReturnType<typeof makeSnippet>;
}

/**
 * Seed snippets into sync only, then wait for the background worker to have
 * projected THIS spec's snippet into the content-script cache.
 *
 * Two deliberate choices:
 *
 * - No storage clearing. Every spec file shares one browser context, but
 *   clearing the `snip:` keys to get a clean slate trips the background's
 *   sign-out detector, and that leaked into later spec files and broke them.
 *   Instead each test uses a shortcut no other spec can shadow, and the cache
 *   assertion is scoped to this spec's own snippet id.
 * - Waiting for the projection rather than typing immediately. The refresh is
 *   debounced, and how fast it lands is cache-coherence.spec.ts's concern, not
 *   this file's.
 */
async function seedSyncAndAwaitCache(
  storageHelper: StorageHelper,
  snippets: { id: string }[]
): Promise<void> {
  await storageHelper.setLocal("cachedSnippets", []);
  await storageHelper.seedSyncOnly(
    snippets as unknown as ReturnType<typeof makeSnippet>[]
  );
  for (const snippet of snippets) {
    await expect
      .poll(
        async () => {
          const cached = (await storageHelper.getLocal("cachedSnippets")) as
            Record<string, unknown>[] | undefined;
          return (cached ?? []).some((s) => s.id === snippet.id);
        },
        {
          timeout: 10_000,
          message: `background never projected ${snippet.id} into the cache`,
        }
      )
      .toBe(true);
  }
}

test.describe("Legacy contentFormat: html", () => {
  test("a legacy HTML snippet inserts with its line structure intact", async ({
    testPage,
    storageHelper,
  }) => {
    await seedSyncAndAwaitCache(storageHelper, [
      legacyHtmlSnippet(
        "legacy-html",
        "/zzq-cfmtpl-legacy",
        "<p>Line one</p><p>Line two</p>"
      ),
    ]);

    await testPage.reload();
    await testPage.waitForLoadState("domcontentloaded");
    await waitForContentScriptReady(testPage);

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.type("/zzq-cfmtpl-legacy");

    await expect(input).toHaveValue(/Line one/, { timeout: 5_000 });
    // The decisive assertion: the body is markdown, not HTML. Before the
    // migration the content script inserted the raw markup, so the field
    // literally contained "<p>".
    const value = await input.inputValue();
    expect(value).not.toContain("<p>");
    expect(value).toContain("Line two");
  });

  test("the stored snippet is converted and the flag is dropped", async ({
    storageHelper,
  }) => {
    await seedSyncAndAwaitCache(storageHelper, [
      legacyHtmlSnippet(
        "legacy-html",
        "/zzq-cfmtpl-legacy",
        "<p>Line one</p><p>Line two</p>"
      ),
    ]);

    const cached = (await storageHelper.getLocal("cachedSnippets")) as
      Record<string, unknown>[] | undefined;
    const snippet = (cached ?? []).find((s) => s.id === "legacy-html");
    expect(snippet).toBeDefined();
    expect(snippet?.["content"]).toBe("Line one\n\nLine two");
    expect(snippet?.["contentFormat"]).toBeUndefined();
  });

  test("a preserved raw-HTML body inserts as escaped text, never as markup", async ({
    testPage,
    storageHelper,
  }) => {
    // A script-only body converts to nothing, so the migration wraps it in the
    // raw-HTML placeholder rather than blanking the user's snippet. That
    // placeholder is content, not markup: it must reach the field as literal
    // characters and must never become a live <script> element.
    await seedSyncAndAwaitCache(storageHelper, [
      legacyHtmlSnippet(
        "legacy-raw",
        "/zzq-cfmtpl-raw",
        "<script>window.__pwned=1</script>"
      ),
    ]);

    await testPage.reload();
    await testPage.waitForLoadState("domcontentloaded");
    await waitForContentScriptReady(testPage);

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.type("/zzq-cfmtpl-raw");

    await expect(input).toHaveValue(/raw_html/, { timeout: 5_000 });

    // The decisive check: the body is inert text, and nothing executed.
    const value = await input.inputValue();
    expect(value).toContain("{{raw_html:");
    expect(value).toContain("__pwned");
    expect(
      await testPage.evaluate(
        () => (window as unknown as Record<string, unknown>)["__pwned"]
      )
    ).toBeUndefined();
  });

  test("a markdown snippet is not affected", async ({
    testPage,
    storageHelper,
  }) => {
    await seedSyncAndAwaitCache(storageHelper, [
      makeSnippet({
        id: "plain-md",
        label: "Plain",
        shortcut: "/zzq-cfmtpl-plain",
        content: "**bold** body",
      }),
    ]);

    await testPage.reload();
    await testPage.waitForLoadState("domcontentloaded");
    await waitForContentScriptReady(testPage);

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.type("/zzq-cfmtpl-plain");

    await expect(input).toHaveValue(/bold/, { timeout: 5_000 });
  });
});
