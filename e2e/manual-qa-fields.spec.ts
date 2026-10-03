/**
 * Every editable field on the manual QA harness must expand a snippet, and the
 * two negative fields must not.
 *
 * spec: specs/shortcut-boundary.spec.md
 * spec: specs/manual-qa-page.spec.md
 *
 * This is the release gate for the bug where the pre-filled rich contenteditable
 * (`#qa-ce-rich`) expanded nothing and showed no palette at all: its content ends
 * in a full stop, so a shortcut typed at the caret had no whitespace before it and
 * both the preview and the auto-expansion declined to fire.
 *
 * The fields are checked inside a few tests rather than one test each: a test
 * here costs a full `launchPersistentContext`, so grouping them keeps the suite's
 * wall-clock cost down. The per-field assertion messages keep a failure
 * attributable to a specific field.
 */

import { test, expect, type Page } from "./fixtures.js";
import { helloSnippet, makeSnippet } from "./helpers/snippets.js";
import { waitForContentScriptReady } from "./helpers/content-script.js";
import { TIMING } from "../src/config/constants.js";

const PREVIEW = "#clipio-snippet-preview-host";
const CLEAR = '[data-testid="qa-clear"]';

/**
 * How long a negative test must wait before concluding nothing happened.
 *
 * Derived from the shipped default rather than hardcoded, so raising
 * `TIMING.TYPING_TIMEOUT` cannot make these assertions pass vacuously by
 * outliving nothing: the expansion timer is cleared and re-armed on every
 * keystroke, so the wait has to exceed the last one. See specs/e2e-suite.spec.md
 * for why only an outlived wait can prove an absence.
 */
const NEGATIVE_SETTLE_MS = TIMING.TYPING_TIMEOUT + 700;

/** Fields that must expand. Each is typed at its caret with no leading space. */
const EXPANDABLE_FIELDS = [
  "qa-input",
  "qa-textarea",
  "qa-ce-basic",
  "qa-ce-nested",
] as const;

/**
 * Negative fields, with the value each must still hold afterwards.
 *
 * A `readonly` input rejects the keystrokes outright, whereas a password input
 * accepts them — so the expected end state differs, but in neither case may the
 * snippet body appear.
 *
 * `qa-new-password` is the load-bearing one. `type="new-password"` reports
 * `input.type === "text"` (it is a separate state from `password`, not an
 * alias), so a gate written against the IDL property lets sign-in and
 * change-password forms through — which is where most password fields live.
 */
const NEGATIVE_FIELDS = [
  { testId: "qa-password", expectedValue: "/hello" },
  { testId: "qa-new-password", expectedValue: "/hello" },
  { testId: "qa-readonly", expectedValue: "readonly" },
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

/**
 * The field's text, reading `.value` for the form controls and `textContent` for
 * the contenteditable ones.
 *
 * `Locator.inputValue()` throws on a contenteditable and `textContent` is null on
 * an `<input>`, so no single accessor serves both halves of the harness.
 */
function readField(page: Page, testId: string): Promise<string> {
  return page
    .locator(`[data-testid="${testId}"]`)
    .evaluate((node: HTMLElement) =>
      node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
        ? node.value
        : (node.textContent ?? "")
    );
}

/**
 * Type the shortcut at the field's caret and assert the whole round trip: the
 * palette opens, the snippet is inserted, the trigger text is consumed, and the
 * palette closes again behind the expansion.
 */
async function expandAndAssert(page: Page, testId: string): Promise<void> {
  const field = page.locator(`[data-testid="${testId}"]`);
  const preview = page.locator(PREVIEW);
  await caretToEnd(page, testId);

  // "/" opens the palette. No leading space: the boundary the trigger needs must
  // come from the field's own preceding content.
  await page.keyboard.type("/", { delay: 30 });
  await expect(preview, `preview should open in ${testId}`).toBeVisible({
    timeout: 5_000,
  });

  // Completing the shortcut consumes it: auto-expansion runs on the typing
  // debounce, so the field ends up holding the snippet body.
  await page.keyboard.type("hello", { delay: 30 });

  await expect
    .poll(() => readField(page, testId), {
      message: `snippet was never inserted in ${testId}`,
      timeout: 8_000,
    })
    .toContain("Hello, World!");

  // The trigger text must be gone, not merely followed by the snippet.
  expect(
    await readField(page, testId),
    `${testId} should not keep the trigger text`
  ).not.toContain("/hello");

  await expect(preview, `preview should close after ${testId}`).toBeHidden();
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

  test("the pre-filled rich field opens the preview, inserts, and keeps its markup", async ({
    context,
  }) => {
    const page = await context.newPage();
    await openManualQa(page);

    // Deliberately first, on the freshly loaded page: the harness's "Clear
    // Fields" empties a contenteditable with `textContent = ""`, which discards
    // the authored `<p>`/`<strong>`/`<em>` markup along with the text. Once
    // cleared, this field is no longer the pre-filled rich target for the rest
    // of the session, and the regression under test cannot be reproduced.
    await expandAndAssert(page, "qa-ce-rich");

    const markup = await page.locator('[data-testid="qa-ce-rich"]').innerHTML();
    expect(markup, "existing <strong> run should survive").toContain(
      "<strong>"
    );
    expect(markup, "existing <em> run should survive").toContain("<em>");
    expect(markup, "pre-existing prose should survive").toContain(
      "Prefix text before shortcut."
    );

    await page.close();
  });

  test("the remaining editable fields open the preview and insert at the caret", async ({
    context,
  }) => {
    const page = await context.newPage();
    await openManualQa(page);

    for (const testId of EXPANDABLE_FIELDS) {
      // The harness's own reset, so each field starts from its authored content
      // rather than from the previous field's leftovers.
      await page.locator(CLEAR).click();
      await expandAndAssert(page, testId);
    }

    await page.close();
  });

  test("negative fields neither expand nor show the preview", async ({
    context,
  }) => {
    const page = await context.newPage();
    await openManualQa(page);

    for (const { testId, expectedValue } of NEGATIVE_FIELDS) {
      await page.locator(CLEAR).click();
      await caretToEnd(page, testId);
      await page.keyboard.type("/hello", { delay: 30 });

      // Long enough for both the typing debounce and a palette that wrongly
      // opened to have committed.
      await page.waitForTimeout(NEGATIVE_SETTLE_MS);

      await expect(
        page.locator(PREVIEW),
        `${testId} must never show the snippet preview`
      ).toBeHidden();
      // Neither expected value contains the snippet body, which is what makes
      // this a negative test rather than a check that the field is empty.
      await expect(page.locator(`[data-testid="${testId}"]`)).toHaveValue(
        expectedValue
      );
    }

    await page.close();
  });
});
