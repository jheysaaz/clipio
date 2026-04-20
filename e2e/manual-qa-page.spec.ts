/**
 * Manual QA harness smoke checks.
 * spec: specs/manual-qa-page.spec.md
 */

import { test, expect } from "./fixtures.js";

test.describe("Manual QA Page", () => {
  test("exposes required editable targets", async ({ context }) => {
    const port = process.env.E2E_SERVER_PORT ?? "7777";
    const page = await context.newPage();

    await page.goto(`http://localhost:${port}/manual-qa.html`);
    await page.waitForLoadState("domcontentloaded");

    await expect(page.locator('[data-testid="qa-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="qa-textarea"]')).toBeVisible();
    await expect(page.locator('[data-testid="qa-ce-basic"]')).toBeVisible();
    await expect(page.locator('[data-testid="qa-ce-nested"]')).toBeVisible();
    await expect(page.locator('[data-testid="qa-ce-rich"]')).toBeVisible();
    await expect(page.locator('[data-testid="qa-password"]')).toBeVisible();

    await page.close();
  });
});
