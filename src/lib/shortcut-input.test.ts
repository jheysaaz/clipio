import { describe, expect, it } from "vitest";
import {
  shortcutBody,
  shortcutInputProblem,
  shortcutSpacesToDashes,
  unsupportedShortcutCharacters,
  withProtectedPrefix,
} from "./shortcut-input";

describe("shortcutBody", () => {
  it("removes only the configured leading prefix", () => {
    expect(shortcutBody("/addr", "/")).toBe("addr");
    expect(shortcutBody(";addr", ";")).toBe("addr");
  });

  it("does not treat a different leading symbol as the prefix", () => {
    // Negative case: stripping any first character would corrupt a shortcut
    // saved under a prefix the user has since changed.
    expect(shortcutBody(";addr", "/")).toBe(";addr");
    expect(shortcutBody("addr", "/")).toBe("addr");
  });
});

describe("shortcutSpacesToDashes", () => {
  it("turns whitespace in a shortcut body into dashes", () => {
    expect(shortcutSpacesToDashes("addr home")).toBe("addr-home");
    expect(shortcutSpacesToDashes("addr\thome")).toBe("addr-home");
  });

  it("leaves other unsupported characters for validation to report", () => {
    // Negative case: silently dropping them would make an invalid edit look
    // accepted.
    expect(shortcutSpacesToDashes("addr$home")).toBe("addr$home");
  });
});

describe("withProtectedPrefix", () => {
  it("keeps the prefix when the user deletes it or types a different one", () => {
    expect(withProtectedPrefix("addr", "/")).toBe("/addr");
    expect(withProtectedPrefix("", "/")).toBe("/");
    expect(withProtectedPrefix(";addr", "/")).toBe("/addr");
    expect(withProtectedPrefix("  /addr", "/")).toBe("/addr");
  });

  it("does not duplicate a prefix the user typed", () => {
    expect(withProtectedPrefix("/addr", "/")).toBe("/addr");
    // Clearing the field restores the prefix; typing it again must not leave
    // two symbols in front of the shortcut.
    expect(withProtectedPrefix("//addr", "/")).toBe("/addr");
  });

  it("leaves an unprefixed shortcut alone when no prefix is configured", () => {
    expect(withProtectedPrefix("addr", "")).toBe("addr");
  });

  it("keeps unsupported characters inside the body for validation to report", () => {
    // Deleting them here would make an invalid shortcut look accepted.
    expect(withProtectedPrefix("/ad dr", "/")).toBe("/ad dr");
    expect(withProtectedPrefix("/ad$dr", "/")).toBe("/ad$dr");
  });
});

describe("shortcutInputProblem", () => {
  it("reports spaces separately from other unsupported characters", () => {
    expect(shortcutInputProblem("/ad dr", "/")).toBe("spaces");
    expect(shortcutInputProblem("/ad$dr", "/")).toBe("characters");
    expect(shortcutInputProblem("/addr_2.test-v2", "/")).toBeNull();
  });

  it("rejects control characters and a prefix inside the body", () => {
    // A doubled prefix at the start is normalised away; the same symbol after
    // body characters is an unsupported character and must stay visible.
    expect(unsupportedShortcutCharacters("/ad\tdr", "/")).toEqual(["\t"]);
    expect(unsupportedShortcutCharacters("/ad/dr", "/")).toEqual(["/"]);
    expect(shortcutInputProblem("/ad/dr", "/")).toBe("characters");
  });

  it("accepts an empty body so the field can be cleared while editing", () => {
    // Emptiness is a separate validation concern elsewhere; the input grammar
    // must not flag the intermediate state while someone retypes the shortcut.
    expect(shortcutInputProblem("/", "/")).toBeNull();
  });
});
