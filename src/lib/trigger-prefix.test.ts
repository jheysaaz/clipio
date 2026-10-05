/**
 * Tests for src/lib/trigger-prefix.ts
 *
 * The behaviour worth pinning is what happens when the stored prefix is not a
 * usable character. The setting is an unvalidated free-text field, so "blank"
 * and "not a string" are reachable states rather than theoretical ones, and a
 * draft prefilled from either of them is broken in a way that looks like the app
 * ignoring the user.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  blankSnippetDraft,
  createSnippetDraft,
  DEFAULT_TRIGGER_PREFIX,
  normaliseTriggerPrefix,
  readTriggerPrefix,
} from "./trigger-prefix";
import { snippetPreviewPrefixItem } from "@/storage/items";

const setPrefix = (value: unknown) =>
  (
    snippetPreviewPrefixItem as unknown as {
      setValue: (v: unknown) => Promise<void>;
    }
  ).setValue(value);

describe("normaliseTriggerPrefix", () => {
  it("passes a configured prefix through unchanged", () => {
    expect(normaliseTriggerPrefix(";")).toBe(";");
  });

  it("trims surrounding whitespace", () => {
    // The Options field takes free text, so " ; " is what a careless paste
    // leaves behind — and a shortcut of " ;addr" matches nothing.
    expect(normaliseTriggerPrefix(" ; ")).toBe(";");
  });

  it("falls back to the default for a blank prefix", () => {
    // Blank is a legitimate *trigger* configuration ("always trigger"), but a
    // shortcut beginning with nothing is not a shortcut.
    expect(normaliseTriggerPrefix("")).toBe(DEFAULT_TRIGGER_PREFIX);
    expect(normaliseTriggerPrefix("   ")).toBe(DEFAULT_TRIGGER_PREFIX);
  });

  it("falls back to the default when the stored value is not a string", () => {
    expect(normaliseTriggerPrefix(null)).toBe(DEFAULT_TRIGGER_PREFIX);
    expect(normaliseTriggerPrefix(undefined)).toBe(DEFAULT_TRIGGER_PREFIX);
    expect(normaliseTriggerPrefix(7)).toBe(DEFAULT_TRIGGER_PREFIX);
  });

  it("keeps a multi-character prefix", () => {
    // Not normalised away: `detectPreviewTrigger` matches on the whole string,
    // so a multi-character trigger is a supported configuration even though the
    // Options field describes a single character.
    expect(normaliseTriggerPrefix("::")).toBe("::");
  });
});

describe("readTriggerPrefix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the configured prefix", async () => {
    await setPrefix(";");

    // The point of the read: a user who changed the setting must not be handed
    // the shipped default.
    await expect(readTriggerPrefix()).resolves.toBe(";");
  });

  it("is re-read on every call rather than cached", async () => {
    await setPrefix("/");
    await expect(readTriggerPrefix()).resolves.toBe("/");

    await setPrefix(";");
    await expect(readTriggerPrefix()).resolves.toBe(";");

    // A value captured when the module loaded would still be "/" here, and the
    // popup document lives long enough for the user to change the setting and
    // come straight back.
  });

  it("falls back to the default when the stored value cannot be read", async () => {
    const spy = vi
      .spyOn(snippetPreviewPrefixItem, "getValue")
      .mockRejectedValue(new Error("extension context invalidated"));

    // The form must still open. Prefilling nothing would leave the user with a
    // blank field and no explanation.
    await expect(readTriggerPrefix()).resolves.toBe(DEFAULT_TRIGGER_PREFIX);
    spy.mockRestore();
  });
});

describe("createSnippetDraft", () => {
  it("prefills the shortcut with the prefix and leaves the rest blank", () => {
    expect(createSnippetDraft(";")).toEqual({
      label: "",
      shortcut: ";",
      content: "",
      tags: [],
    });
  });

  it("carries body text through for a context-menu capture", () => {
    // The context-menu path already has the selected text; only the shortcut is
    // missing, and that is the part the prefix answers.
    expect(createSnippetDraft(";", "selected text")).toEqual({
      label: "",
      shortcut: ";",
      content: "selected text",
      tags: [],
    });
  });

  it("normalises the prefix it is given", () => {
    expect(createSnippetDraft("").shortcut).toBe(DEFAULT_TRIGGER_PREFIX);
  });
});

describe("blankSnippetDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the configured prefix", async () => {
    await setPrefix(";");

    await expect(blankSnippetDraft()).resolves.toEqual({
      label: "",
      shortcut: ";",
      content: "",
      tags: [],
    });
  });

  it("uses the configured prefix for a context-menu capture too", async () => {
    // This is the path that was hardcoded to "/" twice over — the point of the
    // helper is that both entry points go through one definition.
    await setPrefix(";");

    const draft = await blankSnippetDraft("some selected text");
    expect(draft.shortcut).toBe(";");
    expect(draft.content).toBe("some selected text");
  });

  it("falls back to a slash when nothing is configured", async () => {
    await setPrefix(DEFAULT_TRIGGER_PREFIX);

    await expect(blankSnippetDraft()).resolves.toMatchObject({
      shortcut: "/",
    });
  });
});
