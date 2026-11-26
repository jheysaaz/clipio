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

describe("relative-size tokens", () => {
  const theme = declarationsIn("@theme inline");

  it("defines the one type scale, with px-free line heights", () => {
    // The values are the design's 11/12/13/14/18px at a 16px root. Asserting
    // the rem form is what proves the scale scales with the root font.
    expect(theme).toMatch(/--text-ui-micro:\s*0\.6875rem\s*;/);
    expect(theme).toMatch(/--text-ui-xs:\s*0\.75rem\s*;/);
    expect(theme).toMatch(/--text-ui-sm:\s*0\.8125rem\s*;/);
    expect(theme).toMatch(/--text-ui-base:\s*0\.875rem\s*;/);
    expect(theme).toMatch(/--text-ui-lg:\s*1\.125rem\s*;/);
    expect(theme).toMatch(/--leading-ui:\s*1\.5\s*;/);
    expect(theme).toMatch(/--leading-editor:\s*1\.6\s*;/);
  });

  it("keeps the popup's non-scrolling box scoped away from Options", () => {
    // app.css ships to both entrypoints. A global `body { overflow: hidden }`
    // silently disables Options scrolling, so only the popup body may have it.
    expect(declarationsIn("body")).not.toMatch(/overflow:/);
    expect(declarationsIn("body.popup-shell")).toMatch(
      /overflow:\s*hidden\s*;/
    );
  });

  it("derives radii from --radius in rem, never px", () => {
    for (const name of ["sm", "md", "lg", "xl"]) {
      const declaration = theme.match(
        new RegExp(`--radius-${name}:\\s*([^;]+);`)
      );
      expect(declaration, `${name} radius is missing`).not.toBeNull();
      expect(declaration![1]).not.toMatch(/px/);
    }
  });

  it("keeps the shipped size at a 16px root and caps at Chrome's maximum", () => {
    const root = declarationsIn(":root");
    expect(root).toMatch(/--popup-max-width:\s*800px\s*;/);
    expect(root).toMatch(/--popup-max-height:\s*600px\s*;/);
    expect(root).toMatch(
      /--popup-width:\s*min\(42\.5rem,\s*var\(--popup-max-width\)\)\s*;/
    );
    expect(root).toMatch(
      /--popup-height:\s*min\(28\.75rem,\s*var\(--popup-max-height\)\)\s*;/
    );
    // The negative case: a fixed px width would defeat both the rem scale and
    // the cap, even though the numbers in the comment still look right.
    expect(root).not.toMatch(/--popup-width:\s*680px\s*;/);
    expect(root).not.toMatch(/--popup-height:\s*460px\s*;/);
  });
});

describe("selected row fill", () => {
  it("is one neutral token that is stronger than muted in both themes", () => {
    const light = declarationsIn(":root");
    const dark = declarationsIn(".dark");
    expect(light).toMatch(/--selected:\s*oklch\(/);
    expect(dark).toMatch(/--selected:\s*oklch\(/);

    for (const [theme, label] of [
      [light, "light"],
      [dark, "dark"],
    ] as const) {
      const selected = Number(
        theme.match(/--selected:\s*oklch\(([\d.]+)/)?.[1]
      );
      const muted = Number(theme.match(/--muted:\s*oklch\(([\d.]+)/)?.[1]);
      expect(Number.isFinite(selected), `${label} selected lightness`).toBe(
        true
      );
      expect(Number.isFinite(muted), `${label} muted lightness`).toBe(true);
      // `muted` is translucent at 50% in the sidebar. In light that puts the
      // hover fill near white, so selection must be darker; in dark it puts
      // hover near 0.21, so selection must be lighter. Comparing the token to
      // `muted` catches a fill that would vanish once composited.
      if (label === "light") {
        expect(
          selected,
          `${label} selection is not stronger than hover`
        ).toBeLessThan(muted);
      } else {
        expect(
          selected,
          `${label} selection is not stronger than hover`
        ).toBeGreaterThan(muted);
      }
    }
  });
});
