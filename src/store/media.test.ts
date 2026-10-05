import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import {
  buildReferenceMap,
  cancelDelete,
  clearAltSaved,
  dismissDeleteError,
  dismissLoadError,
  disposeObjectUrls,
  findImageItem,
  loadMediaLibrary,
  mediaStore,
  removeMedia,
  requestDelete,
  resetMediaStoreForTests,
  saveAlt,
  setAltDraft,
  setViewMode,
  totalMediaBytes,
  useMedia,
  type MediaState,
} from "./media";

import type { Snippet } from "@/types";
import type { MediaMetadata } from "@/storage/backends/media";

const backend = vi.hoisted(() => ({
  listMedia: vi.fn(),
  getMedia: vi.fn(),
  deleteMedia: vi.fn(),
  updateMediaAlt: vi.fn(),
  getSnippets: vi.fn(),
}));

vi.mock("@/storage/backends/media", () => backend);
vi.mock("@/storage", () => ({ getSnippets: backend.getSnippets }));
vi.mock("@/lib/sentry", () => ({ captureError: vi.fn() }));

function makeMeta(overrides: Partial<MediaMetadata> = {}): MediaMetadata {
  return {
    id: "a1b2c3d4",
    size: 1024,
    alt: undefined,
    ...overrides,
  } as MediaMetadata;
}

function makeSnippet(content: string, label = "Snippet"): Snippet {
  return {
    id: label,
    label,
    content,
    shortcut: "/" + label,
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function state(): MediaState {
  return mediaStore.state;
}

/** Seed the store's items without going through a load. */
function seedItems(items: MediaState["items"]): void {
  mediaStore.setState((prev) => ({ ...prev, items }));
}

beforeEach(() => {
  resetMediaStoreForTests();
  backend.listMedia.mockResolvedValue([]);
  backend.getSnippets.mockResolvedValue([]);
  backend.getMedia.mockResolvedValue(undefined);
  backend.deleteMedia.mockResolvedValue(undefined);
  backend.updateMediaAlt.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------

describe("buildReferenceMap", () => {
  it("maps an image to the snippets using it", () => {
    const content = "see {{image:a1b2c3d4:200}} here";
    expect(buildReferenceMap([makeSnippet(content, "Address")])).toEqual({
      a1b2c3d4: ["Address"],
    });
  });

  it("maps one image to several snippets", () => {
    const map = buildReferenceMap([
      makeSnippet("{{image:a1b2c3d4:200}}", "Address"),
      makeSnippet("{{image:a1b2c3d4:100}}", "Letter"),
    ]);

    expect(map["a1b2c3d4"]).toEqual(["Address", "Letter"]);
  });

  it("counts a snippet that uses the image twice only once", () => {
    // The user should see one warning, not one per placeholder. Two references to
    // the same image in one snippet is one thing to be careful about.
    const map = buildReferenceMap([
      makeSnippet(
        "{{image:a1b2c3d4:200}} and again {{image:a1b2c3d4:400}}",
        "Doc"
      ),
    ]);

    expect(map["a1b2c3d4"]).toEqual(["Doc"]);
  });

  it("deduplicates two snippets that share a label", () => {
    // Real: users name snippets the same thing. Listing the label twice reads as
    // two things at risk and is not.
    const map = buildReferenceMap([
      makeSnippet("{{image:a1b2c3d4:200}}", "Greeting"),
      makeSnippet("{{image:a1b2c3d4:200}}", "Greeting"),
    ]);

    expect(map["a1b2c3d4"]).toEqual(["Greeting"]);
  });

  it("maps several images independently", () => {
    const map = buildReferenceMap([
      makeSnippet("{{image:a1b2c3d4:200}}{{image:b2c3d4e5:200}}", "Both"),
    ]);

    expect(map).toEqual({ a1b2c3d4: ["Both"], b2c3d4e5: ["Both"] });
  });

  it("returns nothing for snippets with no images", () => {
    // The negative case that matters: a library of image-free snippets must not
    // produce entries, or every image would look referenced.
    expect(buildReferenceMap([makeSnippet("plain text", "Plain")])).toEqual({});
    expect(buildReferenceMap([])).toEqual({});
  });
});

// ---------------------------------------------------------------------------

describe("loadMediaLibrary", () => {
  it("fills the library and marks it loaded", async () => {
    backend.listMedia.mockResolvedValue([makeMeta({ id: "a1b2c3d4" })]);
    backend.getMedia.mockResolvedValue({ blob: new Blob(["x"]) });

    await loadMediaLibrary();

    expect(state().items).toHaveLength(1);
    expect(state().items[0].meta.id).toBe("a1b2c3d4");
    expect(state().loading).toBe(false);
    expect(state().loadError).toBeNull();
  });

  it("gives an unreadable blob a row with no preview rather than dropping it", async () => {
    // The user needs to see an unreadable image in order to delete it. Dropping
    // the row would leave it in storage forever with no way to remove it.
    backend.listMedia.mockResolvedValue([makeMeta({ id: "bad" })]);
    backend.getMedia.mockRejectedValue(new Error("corrupt entry"));

    await loadMediaLibrary();

    expect(state().items).toHaveLength(1);
    expect(state().items[0].objectUrl).toBeNull();
  });

  it("marks loaded and reports the error when the read fails", async () => {
    backend.listMedia.mockRejectedValue(new Error("IndexedDB unavailable"));

    await loadMediaLibrary();

    expect(state().loadError).not.toBeNull();
    // Otherwise the section spins forever on an error it cannot show.
    expect(state().loading).toBe(false);
  });

  it("seeds the alt drafts from stored alt text", async () => {
    backend.listMedia.mockResolvedValue([
      makeMeta({ id: "a", alt: "A logo" }),
      makeMeta({ id: "b" }),
    ]);

    await loadMediaLibrary();

    expect(state().altDraft.a).toBe("A logo");
    // An image with no alt text drafts as empty, so the field is editable rather
    // than showing "undefined".
    expect(state().altDraft.b).toBe("");
  });

  it("attaches the referencing snippets to each row", async () => {
    backend.listMedia.mockResolvedValue([makeMeta({ id: "a1b2c3d4" })]);
    backend.getSnippets.mockResolvedValue([
      makeSnippet("{{image:a1b2c3d4:200}}", "Address"),
    ]);

    await loadMediaLibrary();

    expect(state().items[0].referencingSnippets).toEqual(["Address"]);
  });

  it("revokes every object URL it created", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    backend.listMedia.mockResolvedValue([
      makeMeta({ id: "a" }),
      makeMeta({ id: "b" }),
    ]);
    backend.getMedia.mockResolvedValue({ blob: new Blob(["x"]) });

    await loadMediaLibrary();
    expect(revoke).not.toHaveBeenCalled();

    disposeObjectUrls();

    // Two rows, two URLs, two revocations. Leaking these pins the blobs in memory
    // for the life of the document.
    expect(revoke).toHaveBeenCalledTimes(2);
    revoke.mockRestore();
  });
});

// ---------------------------------------------------------------------------

describe("alt text", () => {
  beforeEach(() => {
    seedItems([
      {
        meta: makeMeta({ id: "a", alt: "old" }),
        objectUrl: null,
        referencingSnippets: [],
      },
    ]);
  });

  it("records what the user typed", () => {
    setAltDraft("a", "new");
    expect(state().altDraft.a).toBe("new");
  });

  it("writes the draft onto the row and flashes Saved", async () => {
    setAltDraft("a", "new alt");

    await expect(saveAlt("a")).resolves.toBe(true);

    expect(state().items[0].meta.alt).toBe("new alt");
    expect(state().altSaved.a).toBe(true);
    expect(state().altErrors.a).toBe("");
  });

  it("stores a cleared alt text as absent, not as an empty string", async () => {
    // The distinction between "the user cleared it" and "never filled it in". An
    // empty string round-tripped into every reader of the metadata.
    setAltDraft("a", "   ");

    await saveAlt("a");

    expect(state().items[0].meta.alt).toBeUndefined();
  });

  it("trims the stored value", async () => {
    setAltDraft("a", "  padded  ");

    await saveAlt("a");

    expect(state().items[0].meta.alt).toBe("padded");
  });

  it("records the failure and leaves the row alone", async () => {
    backend.updateMediaAlt.mockRejectedValue(new Error("write failed"));
    setAltDraft("a", "new alt");

    await expect(saveAlt("a")).resolves.toBe(false);

    expect(state().altErrors.a).not.toBe("");
    // The row still shows what is stored. Claiming otherwise would tell the user
    // their description was saved when it was not.
    expect(state().items[0].meta.alt).toBe("old");
    // And no "Saved" flash beside the error.
    expect(state().altSaved.a).toBeUndefined();
  });

  it("clears the flash", () => {
    mediaStore.setState((prev) => ({ ...prev, altSaved: { a: true } }));
    clearAltSaved("a");
    expect(state().altSaved.a).toBe(false);
  });

  it("treats an image with no draft as an empty one", async () => {
    // Saving an image whose draft was never seeded must not write `undefined`
    // into storage.
    await saveAlt("never-edited");

    expect(backend.updateMediaAlt).toHaveBeenCalledWith("never-edited", "");
  });
});

// ---------------------------------------------------------------------------

describe("deleting", () => {
  beforeEach(() => {
    seedItems([
      {
        meta: makeMeta({ id: "a" }),
        objectUrl: "blob:a",
        referencingSnippets: [],
      },
      { meta: makeMeta({ id: "b" }), objectUrl: null, referencingSnippets: [] },
    ]);
  });

  it("removes the row and closes the dialog", async () => {
    requestDelete("a");

    await expect(removeMedia("a")).resolves.toBe(true);

    expect(state().items.map((i) => i.meta.id)).toEqual(["b"]);
    expect(state().confirmDeleteId).toBeNull();
  });

  it("revokes the deleted row's object URL", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    await removeMedia("a");
    expect(revoke).toHaveBeenCalledWith("blob:a");
    revoke.mockRestore();
  });

  it("records the failure, closes the dialog, and keeps the row", async () => {
    backend.deleteMedia.mockRejectedValue(new Error("locked"));
    requestDelete("a");

    await expect(removeMedia("a")).resolves.toBe(false);

    expect(state().deleteErrors.a).not.toBe("");
    // The row is still there: a failed delete must not look like a delete.
    expect(state().items).toHaveLength(2);
    // And the dialog closes, because it has nowhere to render `deleteErrors`.
    expect(state().confirmDeleteId).toBeNull();
  });

  it("cancels without deleting", () => {
    requestDelete("a");
    cancelDelete();
    expect(state().confirmDeleteId).toBeNull();
    expect(backend.deleteMedia).not.toHaveBeenCalled();
  });

  it("dismisses a delete error", async () => {
    backend.deleteMedia.mockRejectedValue(new Error("locked"));
    await removeMedia("a");
    expect(state().deleteErrors.a).toBeDefined();

    dismissDeleteError("a");

    // Keyed state, so it is deleted rather than blanked: a blank value would still
    // be truthy for a `hasOwnProperty` check and render an empty error.
    expect("a" in state().deleteErrors).toBe(false);
  });

  it("does not change state when dismissing an error that is not there", () => {
    const before = state();
    dismissDeleteError("nope");
    expect(state()).toBe(before);
  });
});

// ---------------------------------------------------------------------------

describe("view mode", () => {
  it("starts as a list and switches", () => {
    expect(state().viewMode).toBe("list");
    setViewMode("grid");
    expect(state().viewMode).toBe("grid");
  });
});

describe("derived", () => {
  it("sums the library's bytes", () => {
    seedItems([
      {
        meta: makeMeta({ id: "a", size: 100 }),
        objectUrl: null,
        referencingSnippets: [],
      },
      {
        meta: makeMeta({ id: "b", size: 250 }),
        objectUrl: null,
        referencingSnippets: [],
      },
    ]);

    expect(totalMediaBytes(state().items)).toBe(350);
  });

  it("sums an empty library to zero", () => {
    expect(totalMediaBytes(state().items)).toBe(0);
  });

  it("finds the row the dialog is open for", () => {
    seedItems([
      { meta: makeMeta({ id: "a" }), objectUrl: null, referencingSnippets: [] },
    ]);
    expect(findImageItem(state().items, "a")?.meta.id).toBe("a");
  });

  it("returns null for no id, and for an id that is gone", () => {
    // The deep-link case: the dialog can be open for an image deleted in another
    // context.
    expect(findImageItem(state().items, null)).toBeNull();
    expect(findImageItem(state().items, "gone")).toBeNull();
  });
});

describe("dismissLoadError", () => {
  it("clears the error", () => {
    mediaStore.setState((prev) => ({ ...prev, loadError: "Failed." }));
    dismissLoadError();
    expect(state().loadError).toBeNull();
  });
});

describe("React bindings", () => {
  it("re-renders on a change and reports the new value", () => {
    // The binding has to be measured rather than merely present. A binding wired
    // to the wrong store fails silently at runtime: the selector returns a valid
    // undefined-shaped value rather than throwing, and the section renders an
    // empty library with no error anywhere.
    const { result } = renderHook(() => ({
      viewMode: useMedia((s) => s.viewMode),
      count: useMedia((s) => s.items.length),
    }));

    expect(result.current.viewMode).toBe("list");
    expect(result.current.count).toBe(0);

    act(() => setViewMode("grid"));

    expect(result.current.viewMode).toBe("grid");

    act(() =>
      mediaStore.setState((prev) => ({
        ...prev,
        items: [{ meta: makeMeta(), objectUrl: null, referencingSnippets: [] }],
      }))
    );

    expect(result.current.count).toBe(1);
  });
});
