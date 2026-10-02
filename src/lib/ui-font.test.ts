/**
 * Tests for src/lib/ui-font.ts
 * spec: specs/ui-font.spec.md
 */

import { describe, it, expect } from "vitest";
import {
  UI_FONT_OPTIONS,
  UI_FONT_STACKS,
  DEFAULT_UI_FONT,
  UI_FONT_ATTRIBUTE,
  UI_FONT_VARIABLE,
  isUiFont,
  normalizeUiFont,
  type UiFont,
} from "@/lib/ui-font";

describe("UI_FONT_OPTIONS", () => {
  // spec: the option set is exactly Inter, System, OpenDyslexic, in that order.
  it("is the closed set the Appearance panel offers", () => {
    expect([...UI_FONT_OPTIONS]).toEqual(["inter", "system", "dyslexic"]);
  });

  // spec: inter is the default, so the setting is a no-op for existing users.
  it("defaults to inter", () => {
    expect(DEFAULT_UI_FONT).toBe("inter");
    expect(UI_FONT_OPTIONS).toContain(DEFAULT_UI_FONT);
  });

  // A missing entry in UI_FONT_STACKS would leave the preview palette — which
  // cannot use a custom property — with no family to apply.
  it("gives every option a font stack", () => {
    for (const option of UI_FONT_OPTIONS) {
      expect(UI_FONT_STACKS[option]).toBeTruthy();
      expect(typeof UI_FONT_STACKS[option]).toBe("string");
    }
  });
});

describe("UI_FONT_STACKS", () => {
  // spec: each option leads with its own family, so the choice is observable.
  it("leads with the family the option names", () => {
    expect(UI_FONT_STACKS.inter.split(",")[0].trim()).toBe("InterVariable");
    expect(UI_FONT_STACKS.system.split(",")[0].trim()).toBe("system-ui");
    expect(UI_FONT_STACKS.dyslexic.split(",")[0].trim()).toBe("OpenDyslexic");
  });

  // spec: every stack falls through to the system stack so a missing glyph or
  // weight renders in something that has it rather than as tofu.
  it("falls through to the system stack in every option", () => {
    const tail = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI"';
    for (const option of UI_FONT_OPTIONS) {
      expect(UI_FONT_STACKS[option]).toContain(tail);
      expect(UI_FONT_STACKS[option].endsWith("sans-serif")).toBe(true);
    }
  });

  // "system" means the platform default, which is system-ui. If the inter or
  // dyslexic stack ever resolved to a bundled face first, choosing "system"
  // would still be showing Inter and the three options would not be distinct.
  it("does not name a bundled face for the system option", () => {
    expect(UI_FONT_STACKS.system).not.toContain("InterVariable");
    expect(UI_FONT_STACKS.system).not.toContain("OpenDyslexic");
  });

  // spec: the stacks are also written into the preview palette's inline styles,
  // so a stray newline or unterminated quote would break that page.
  it("is safe to inline into a style attribute", () => {
    for (const option of UI_FONT_OPTIONS) {
      const inline = `font-family: ${UI_FONT_STACKS[option]};`;
      expect(inline).not.toContain("\n");
      expect(inline.endsWith(";")).toBe(true);
    }
  });
});

describe("isUiFont", () => {
  it("accepts every declared option", () => {
    for (const option of UI_FONT_OPTIONS) {
      expect(isUiFont(option)).toBe(true);
    }
  });

  // spec: negative cases. A near-miss string is the realistic failure — a stale
  // value, a typo, or a value from a build that had different options.
  const rejected: Array<[unknown, string]> = [
    ["Inter", "wrong case"],
    ["opendyslexic", "wrong spelling"],
    ["dyslexic ", "trailing space"],
    ["", "empty string"],
    [null, "null"],
    [undefined, "undefined"],
    [0, "number"],
    [1, "truthy number"],
    [true, "boolean"],
    [{}, "object"],
    [["inter"], "array"],
    [() => "inter", "function"],
  ];

  it.each(rejected)("rejects %j (%s)", (value) => {
    expect(isUiFont(value)).toBe(false);
  });
});

describe("normalizeUiFont", () => {
  // spec: the migration path — a recognised value survives untouched.
  it.each(UI_FONT_OPTIONS)("returns %j unchanged", (option) => {
    expect(normalizeUiFont(option)).toBe(option);
  });

  // spec: anything unrecognised becomes the default rather than rendering a
  // select with no selection or a font-family that resolves to nothing.
  const unrecognised: Array<[unknown, string]> = [
    ["Inter", "wrong case"],
    ["dyslexic ", "trailing space"],
    ["", "empty string"],
    [null, "null"],
    [undefined, "never written"],
    [0, "zero"],
    [42, "number"],
    [true, "boolean"],
    [{ font: "inter" }, "object"],
    [["system"], "array"],
  ];

  it.each(unrecognised)("falls back to the default for %j (%s)", (value) => {
    expect(normalizeUiFont(value)).toBe(DEFAULT_UI_FONT);
  });

  // spec: total. Storage can hand back anything, and a throw here would take
  // down the popup render rather than just the setting.
  it("never throws", () => {
    const hostile = [
      Symbol("x"),
      () => {
        throw new Error("boom");
      },
      new Proxy(
        {},
        {
          get: () => {
            throw new Error("trap");
          },
        }
      ),
    ];
    for (const value of hostile) {
      expect(() => normalizeUiFont(value)).not.toThrow();
      expect(normalizeUiFont(value)).toBe(DEFAULT_UI_FONT);
    }
  });
});

describe("DOM contract", () => {
  // spec: FontContext writes this attribute and app.css selects on it. If the
  // two drift, the page silently keeps the default and the setting looks broken
  // with no error anywhere.
  it("names the attribute the stylesheet matches", () => {
    expect(UI_FONT_ATTRIBUTE).toBe("data-ui-font");
    expect(UI_FONT_ATTRIBUTE.startsWith("data-")).toBe(true);
  });

  it("names the custom property every family resolves through", () => {
    expect(UI_FONT_VARIABLE).toBe("--font-ui");
    expect(UI_FONT_VARIABLE.startsWith("--")).toBe(true);
  });
});

// The type union and the runtime list are kept in sync by construction, but a
// future edit could widen one and not the other. This pins the mapping.
describe("type/runtime agreement", () => {
  it("types every runtime option as UiFont", () => {
    const exhaustive: Record<UiFont, true> = {
      inter: true,
      system: true,
      dyslexic: true,
    };
    expect(Object.keys(exhaustive).sort()).toEqual([...UI_FONT_OPTIONS].sort());
  });
});
