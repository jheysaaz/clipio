import { describe, it, expect } from "vitest";
import type { Snippet } from "@/types";
import {
  draftFromForm,
  draftFromSnippet,
  fieldsFromForm,
  fieldsFromSnippet,
  hasMalformedMediaPlaceholder,
  updateDraftFields,
  validateEditorFields,
} from "./snippet-draft";

const UUID = "550e8400-e29b-41d4-a716-446655440000";

function snippet(overrides: Partial<Snippet> = {}): Snippet {
  return {
    id: "s1",
    label: "Snippet",
    content: "body",
    shortcut: "/s",
    tags: ["personal"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const fields = () => ({
  label: "Snippet",
  content: "body",
  shortcut: "/s",
  tags: ["personal"],
});

describe("field extraction", () => {
  it("copies tags so later array mutation cannot change the source", () => {
    const source = snippet();
    const copied = fieldsFromSnippet(source);
    copied.tags!.push("extra");
    expect(source.tags).toEqual(["personal"]);
  });

  it("defaults missing form tags to an empty array", () => {
    expect(
      fieldsFromForm({ label: "L", shortcut: "s", content: "c" }).tags
    ).toEqual([]);
  });
});

describe("validateEditorFields", () => {
  it("accepts a complete, conflict-free draft", () => {
    expect(validateEditorFields(fields(), [])).toEqual({ ok: true });
  });

  it.each([
    ["emptyLabel", { label: "   " }, "emptyLabel"],
    ["emptyShortcut", { shortcut: "" }, "emptyShortcut"],
    ["shortcutSpaces", { shortcut: "/two words" }, "shortcutSpaces"],
    ["emptyContent", { content: " \n " }, "emptyContent"],
  ] as const)("rejects %s", (_name, patch, problem) => {
    const result = validateEditorFields({ ...fields(), ...patch }, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toBe(problem);
  });

  it("rejects a shortcut that collides with a stored snippet", () => {
    const stored = snippet({ id: "other", shortcut: "/s" });
    const result = validateEditorFields(fields(), [stored]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem).toBe("shortcutConflict");
      expect(result.conflict?.type).toBe("exact");
    }
  });

  it("ignores the snippet being edited when checking conflicts", () => {
    expect(
      validateEditorFields(
        fields(),
        [snippet({ id: "s1", shortcut: "/s" })],
        "s1"
      )
    ).toEqual({ ok: true });
  });

  it("accepts well-formed image and gif placeholders", () => {
    const body = `a {{image:${UUID}:200}} b {{gif:abc123}}`;
    expect(validateEditorFields({ ...fields(), content: body }, [])).toEqual({
      ok: true,
    });
  });

  it("rejects a malformed media placeholder", () => {
    const result = validateEditorFields(
      { ...fields(), content: `a {{image:not_a_uuid}}` },
      []
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toBe("malformedMedia");
  });
});

describe("hasMalformedMediaPlaceholder", () => {
  it("detects an unbalanced opener", () => {
    expect(hasMalformedMediaPlaceholder("before {{image:" + UUID)).toBe(true);
  });

  it("returns false for text without a media opener", () => {
    expect(hasMalformedMediaPlaceholder("just text {{cursor}}")).toBe(false);
  });
});

describe("draft construction", () => {
  it("starts a new draft at revision zero", () => {
    const draft = draftFromForm(
      "new-id",
      { label: "L", shortcut: "/l", content: "c" },
      "2026-02-01T00:00:00.000Z"
    );
    expect(draft).toMatchObject({
      id: "new-id",
      isNew: true,
      baseRev: 0,
      updatedAt: "2026-02-01T00:00:00.000Z",
    });
  });

  it("keeps the base revision when drafting an existing snippet", () => {
    const draft = draftFromSnippet(snippet({ rev: 9 }), 9);
    expect(draft.baseRev).toBe(9);
    expect(draft.isNew).toBe(false);
  });

  it("updates fields without losing the base revision or aliasing tags", () => {
    const draft = draftFromSnippet(snippet(), 4);
    const nextFields = { ...fields(), tags: ["new"] };
    const next = updateDraftFields(
      draft,
      nextFields,
      "2026-03-01T00:00:00.000Z"
    );
    nextFields.tags!.push("later");
    expect(next.baseRev).toBe(4);
    expect(next.fields.tags).toEqual(["new"]);
    expect(next.updatedAt).toBe("2026-03-01T00:00:00.000Z");
  });
});
