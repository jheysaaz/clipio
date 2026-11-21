/**
 * Pins the Chrome force-dark opt-out against the stylesheet that ships.
 *
 * `chrome://flags/#enable-force-dark` ("Auto Dark Mode for Web Contents") is a
 * paint-time filter. Measured with the flag on and everything else identical:
 * without a declaration, 99.1% of the light popup's pixels and 1.1% of the
 * dark popup's pixels were repainted. `color-scheme: only light` on `:root`
 * made both 0.0%. Re-declaring `color-scheme: dark` on `.dark` brought the
 * repaint back — so the declaration's *location and spelling* are the whole
 * fix, not just its presence.
 *
 * happy-dom cannot paint, and a browser-flag screenshot comparison is not app
 * behaviour, so decision 0006 keeps this out of the E2E suite. What this test
 * proves is narrower and still worth gating: the exact declaration the browser
 * experiment found necessary is in the CSS, and nothing reintroduces the
 * declaration that undid it.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CSS_PATH = "src/app.css";

// Comments in app.css quote the rejected declarations to explain why they are
// rejected. Strip them so the assertions read only what the browser sees.
const css = readFileSync(CSS_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function declarationsIn(selector: string): string {
  const block = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`));
  if (!block) throw new Error(`No ${selector} block in app.css`);
  return block[1];
}

describe("Chrome force-dark opt-out", () => {
  it("is declared on :root, the element Chrome checks", () => {
    expect(declarationsIn(":root")).toMatch(/color-scheme:\s*only light\s*;/);
  });

  it("is not undone by the dark theme", () => {
    // A plain `dark` here replaces the root's `only light` in the cascade.
    // Measured effect: the filter came back and brightened a 39,39,42 border
    // to 73,73,75 in the otherwise unchanged dark popup.
    expect(declarationsIn(".dark")).not.toMatch(/color-scheme\s*:/);
  });

  it("rejects the declarations that do not opt out", () => {
    const root = declarationsIn(":root");
    for (const value of [
      "light",
      "dark",
      "light dark",
      "normal",
      "only dark",
    ]) {
      expect(
        root,
        `${value} does not stop force dark from repainting our UI`
      ).not.toMatch(new RegExp(`color-scheme:\\s*${value}\\s*;`));
    }
  });
});
