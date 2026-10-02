/**
 * Every editable field on the manual QA harness must expand a snippet, and the
 * two negative fields must not.
 *
 * spec: specs/manual-qa-fields.spec.md
 *
 * This is the release-gate for the bug where the prefilled rich contenteditable
 * (`#qa-ce-rich`) expanded nothing and showed no palette at all: its content
 * ends in a full stop, so a shortcut typed at the caret had no whitespace before
 * it and both the preview and the auto-expansion declined to fire.
 */

import { test, expect, type Page } from "./fixtures.js";
import { helloSnippet } from "./helpers/snippets.js";
import { waitForContentScriptReady } from "./helpers/content-script.js";
import { makeSnippet } from "./helpers/snippets.js";

const PREVIEW = "#clipio-snippet-preview-host";

/** Fields that must expand. Each is typed at its caret with no leading space. */
const EXPANDABLE_FIELDS = [
  { testId: "qa-input", label: "Text Input" },
  { testId: "qa-textarea", label: "Textarea" },
  { testId: "qa-ce-basic", label: "Contenteditable (basic)" },
  { testId: "qa-ce-nested", label: "Contenteditable (nested wrappers)" },
  { testId: "qa-ce-rich", label: "Contenteditable (prefilled rich-ish HTML)" },
] as const;

/** Negative fields: typing must leave them exactly as they were. */
const NEGATIVE_FIELDS = [
  { testId: "qa-password", label: "Password" },
  { testId: "qa-readonly", label: "Readonly input" },
] as const;

async function openManualQa(page: Page): Promise<void> {
  const port = process.env.E2E_SERVER_PORT ?? "7777";
  await page.goto(`http://localhost:${port}/manual-qa.html`);
  await page.waitForLoadState("domcontentloaded");
  await waitForContentScriptReady(page);
}

/**
 * Put the caret at the very end of the field's content.
 *
 * This is what a user gets from clicking the last character, and it is the
 * position that regressed: in `#qa-ce-rich` it lands directly after a full stop.
 */
async function caretToEnd(page: Page, testId: string): Promise<void> {
  await page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
    el.focus();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const end = el.value.length;
      el.setSelectionRange(end, end);
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, testId);
}

test.describe("Manual QA harness — snippet expansion", () => {
  test.beforeEach(async ({ storageHelper }) => {
    await storageHelper.seedSnippets([
      helloSnippet(),
      makeSnippet({
        id: "qa-md",
        label: "Markdown Snippet",
        shortcut: "/qa-md",
        content: "**Bold** and _italic_",
      }),
    ]);
  });

  for (const { testId, label } of EXPANDABLE_FIELDS) {
    test(`${label}: typing a shortcut at the caret opens the preview and inserts`, async ({
      context,
    }) => {
      const page = await context.newPage();
      await openManualQa(page);

      const field = page.locator(`[data-testid="${testId}"]`);
      const preview = page.locator(PREVIEW);
      await caretToEnd(page, testId);

      // "/" opens the palette filtered to snippets matching the query typed
      // after it. No leading space: the boundary must come from the field's
      // own preceding content.
      await page.keyboard.type("/", { delay: 30 });
      await expect(preview, `preview should open in ${testId}`).toBeVisible({
        timeout: 5_000,
      });

      // Completing the shortcut consumes it (auto-expansion after the typing
      // debounce), so the field must end up holding the snippet body and no
      // leftover trigger text.
      await page.keyboard.type("hello", { delay: 30 });

      await expect
        .poll(
          async () => {
            const el = page.locator(`[data-testid="${testId}"]`);
            return (
              (await el.evaluate((node: HTMLElement) =>
                node instanceof HTMLInputElement ||
                node instanceof HTMLTextAreaElement
                  ? node.value
                  : (node.textContent ?? "")
              )) ?? ""
            );
          },
          { message: `snippet was never inserted in ${testId}`, timeout: 8_000 }
        )
        .toContain("Hello, World!");

      // The trigger text must be gone, not merely followed by the snippet.
      const after = await field.evaluate((node: HTMLElement) =>
        node instanceof HTMLInputElement ||
        node instanceof HTMLTextAreaElement
          ? node.value
          : (node.textContent ?? "")
      );
      expect(after, `${testId} should not keep the trigger text`).not.toContain(
        "/hello"
      );
    });
  }

  test("prefilled rich contenteditable keeps the surrounding rich markup", async ({
    context,
  }) => {
    const page = await context.newPage();
    await openManualQa(page);

    const field = page.locator('[data-testid="qa-ce-rich"]');
    await caretToEnd(page, "qa-ce-rich");
    await page.keyboard.type("/hello", { delay: 30 });

    await expect
      .poll(async () => (await field.textContent()) ?? "", {
        message: "snippet was never inserted into the prefilled field",
      })
      .toContain("Hello, World!");

    // Inserting must not flatten the existing formatting around the caret.
    const markup = await field.innerHTML();
    expect(markup, "existing <strong> run should survive").toContain("<strong>");
    expect(markup, "existing <em> run should survive").toContain("<em>");
    expect(markup, "pre-existing prose should survive").toContain(
      "Prefix text before shortcut."
    );
  });

  for (const { testId, label } of NEGATIVE_FIELDS) {
    test(`${label} (negative): neither expands nor shows the preview`, async ({
      context,
    }) => {
      const page = await context.newPage();
      await openManualQa(page);

      const field = page.locator(`[data-testid="${testId}"]`);
      await caretToEnd(page, testId);
      const before = await field.inputValue();

      await page.keyboard.type("/hello", { delay: 30 });
      // Long enough for both the typing debounce and a palette that wrongly
      // opened to have committed.
      await page.waitForTimeout(1_000);

      await expect(
        page.locator(PREVIEW),
        `${testId} must never show the snippet preview`
      ).toBeHidden();
      await expect(field).toHaveValue(before);
      expect(before).not.toContain("Hello, World!");
    });
  }
});
