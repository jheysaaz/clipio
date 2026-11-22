/**
 * Direct tests for the images library surface.
 *
 * The component itself owns no store state, but it owns the presentation
 * branches that matter: which view renders, when the delete dialog opens, how
 * alt-text saves are confirmed, and which errors are visible. Those branches
 * are driven here against a controlled store fixture.
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { i18n } from "#i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockImageItem = {
  meta: {
    id: string;
    mimeType: string;
    width: number;
    height: number;
    size: number;
    originalSize: number;
    createdAt: string;
    alt?: string;
  };
  objectUrl: string | null;
  referencingSnippets: string[];
};

type MockState = {
  items: MockImageItem[];
  loading: boolean;
  loadError: string | null;
  deleteErrors: Record<string, string>;
  confirmDeleteId: string | null;
  viewMode: "list" | "grid";
  altDraft: Record<string, string>;
  altSaved: Record<string, boolean>;
  altErrors: Record<string, string>;
};

const emptyState = (): MockState => ({
  items: [],
  loading: false,
  loadError: null,
  deleteErrors: {},
  confirmDeleteId: null,
  viewMode: "list",
  altDraft: {},
  altSaved: {},
  altErrors: {},
});

const mocks = vi.hoisted(() => ({
  state: {
    items: [],
    loading: false,
    loadError: null,
    deleteErrors: {},
    confirmDeleteId: null,
    viewMode: "list",
    altDraft: {},
    altSaved: {},
    altErrors: {},
  } as MockState,
  loadMediaLibrary: vi.fn().mockResolvedValue(undefined),
  disposeObjectUrls: vi.fn(),
  dismissLoadError: vi.fn(),
  clearAltSaved: vi.fn(),
  removeMedia: vi.fn().mockResolvedValue(undefined),
  requestDelete: vi.fn(),
  cancelDelete: vi.fn(),
  saveAlt: vi.fn().mockResolvedValue(true),
  setAltDraft: vi.fn(),
  setViewMode: vi.fn(),
}));

vi.mock("@/store/media", () => ({
  useMedia: (selector: (state: MockState) => unknown) => selector(mocks.state),
  loadMediaLibrary: mocks.loadMediaLibrary,
  disposeObjectUrls: mocks.disposeObjectUrls,
  dismissLoadError: mocks.dismissLoadError,
  clearAltSaved: mocks.clearAltSaved,
  findImageItem: (items: MockImageItem[], id: string | null) =>
    items.find((item) => item.meta.id === id),
  loadMedia: mocks.loadMediaLibrary,
  removeMedia: mocks.removeMedia,
  requestDelete: mocks.requestDelete,
  cancelDelete: mocks.cancelDelete,
  saveAlt: mocks.saveAlt,
  setAltDraft: mocks.setAltDraft,
  setViewMode: mocks.setViewMode,
  totalMediaBytes: (items: MockImageItem[]) =>
    items.reduce((sum, item) => sum + item.meta.size, 0),
}));

vi.mock("@/components/ui/icon", () => ({
  Icon: ({
    icon: _icon,
    ...props
  }: {
    icon: unknown;
    [key: string]: unknown;
  }) => <span data-testid="mock-icon" {...props} />,
}));

import { ImagesSection } from "./ImagesSection";

function item(overrides: Partial<MockImageItem> = {}): MockImageItem {
  return {
    meta: {
      id: "img-1",
      mimeType: "image/png",
      width: 640,
      height: 480,
      size: 2048,
      originalSize: 4096,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    objectUrl: "blob:preview",
    referencingSnippets: ["Greeting"],
    ...overrides,
  };
}

function setState(patch: Partial<MockState>) {
  mocks.state = { ...mocks.state, ...patch };
}

const nativeSetTimeout = globalThis.setTimeout;
let timeoutSpy: ReturnType<typeof vi.spyOn> | undefined;
let savedFlashTimers: Array<() => void> = [];

beforeEach(() => {
  mocks.state = emptyState();
  savedFlashTimers = [];
  for (const fn of [
    mocks.loadMediaLibrary,
    mocks.disposeObjectUrls,
    mocks.dismissLoadError,
    mocks.clearAltSaved,
    mocks.removeMedia,
    mocks.requestDelete,
    mocks.cancelDelete,
    mocks.saveAlt,
    mocks.setAltDraft,
    mocks.setViewMode,
  ]) {
    fn.mockReset();
  }
  mocks.loadMediaLibrary.mockResolvedValue(undefined);
  mocks.removeMedia.mockResolvedValue(undefined);
  mocks.saveAlt.mockResolvedValue(true);

  // Hold the component's 2000ms "Saved" reset so the test can fire it itself;
  // leave every other timer (including Testing Library's) untouched.
  timeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
    handler: (...args: unknown[]) => void,
    timeout?: number,
    ...args: unknown[]
  ) => {
    if (timeout === 2000) {
      savedFlashTimers.push(handler);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }
    return nativeSetTimeout(handler, timeout, ...args);
  }) as unknown as typeof setTimeout);
});

afterEach(() => {
  timeoutSpy?.mockRestore();
  timeoutSpy = undefined;
});

describe("ImagesSection", () => {
  it("loads the library on mount and disposes object URLs on unmount", () => {
    const { unmount } = render(<ImagesSection />);

    expect(mocks.loadMediaLibrary).toHaveBeenCalledTimes(1);
    expect(mocks.disposeObjectUrls).not.toHaveBeenCalled();

    unmount();

    expect(mocks.disposeObjectUrls).toHaveBeenCalledTimes(1);
  });

  it("shows a loading state and no library actions", () => {
    setState({ loading: true });

    render(<ImagesSection />);

    expect(
      screen.getByText(i18n.t("options.images.loading"))
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: i18n.t("options.images.viewGrid") })
    ).not.toBeInTheDocument();
  });

  it("shows a dismissible load error", () => {
    setState({ loadError: "Could not load images" });

    render(<ImagesSection />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load images"
    );
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("common.dismissError") })
    );
    expect(mocks.dismissLoadError).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state when the library has no images", () => {
    render(<ImagesSection />);

    expect(
      screen.getByText(i18n.t("options.images.empty"))
    ).toBeInTheDocument();
    expect(screen.queryByTestId("image-row-img-1")).not.toBeInTheDocument();
  });

  it("lists images with previews, dimensions, references and errors", () => {
    setState({
      items: [
        item(),
        item({
          meta: {
            id: "img-2",
            mimeType: "image/jpeg",
            width: 0,
            height: 0,
            size: 1024,
            originalSize: 2048,
            createdAt: "2026-01-02T00:00:00.000Z",
          },
          objectUrl: null,
          referencingSnippets: [],
        }),
      ],
      altDraft: { "img-1": "a cat" },
      altSaved: { "img-1": true },
      altErrors: { "img-2": "Alt text too long" },
      deleteErrors: { "img-2": "Delete failed" },
    });

    render(<ImagesSection />);

    const first = screen.getByTestId("image-row-img-1");
    const second = screen.getByTestId("image-row-img-2");
    expect(first.querySelector("img")).toHaveAttribute("src", "blob:preview");
    expect(second.querySelector("img")).not.toBeInTheDocument();
    expect(first).toHaveTextContent("PNG");
    expect(first).toHaveTextContent("2.0 KB");
    expect(first).toHaveTextContent(
      i18n.t("options.images.dimensions", [640, 480])
    );
    expect(first).toHaveTextContent(
      i18n.t("options.images.referencedBy", ["Greeting"])
    );
    expect(second).toHaveTextContent(i18n.t("options.images.noReferences"));
    expect(second).toHaveTextContent("Alt text too long");
    expect(second).toHaveTextContent("Delete failed");
    expect(
      within(first).getByRole("textbox", {
        name: i18n.t("options.images.altText.label"),
      })
    ).toHaveValue("a cat");
    expect(
      within(first).queryByRole("button", { name: i18n.t("common.save") })
    ).not.toBeInTheDocument();
    expect(within(first).getAllByTestId("mock-icon").length).toBeGreaterThan(0);

    fireEvent.click(
      screen.getByRole("button", {
        name: `${i18n.t("options.images.deleteButton")} img-1`,
      })
    );
    expect(mocks.requestDelete).toHaveBeenCalledWith("img-1");
  });

  it("switches between list and grid views", () => {
    setState({ items: [item()] });

    const list = render(<ImagesSection />);

    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("options.images.viewGrid") })
    );
    expect(mocks.setViewMode).toHaveBeenCalledWith("grid");
    list.unmount();

    setState({ viewMode: "grid" });
    render(<ImagesSection />);

    expect(screen.getByTestId("image-row-img-1")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: `${i18n.t("options.images.deleteButton")} img-1`,
      })
    );
    expect(mocks.requestDelete).toHaveBeenCalledWith("img-1");
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("options.images.viewList") })
    );
    expect(mocks.setViewMode).toHaveBeenCalledWith("list");
  });

  it("reports storage use against the configured limit in both colour bands", () => {
    setState({ items: [item()] });

    const { unmount } = render(<ImagesSection />);
    expect(
      screen.getByRole("progressbar", {
        name: i18n.t("options.images.totalStorage"),
      })
    ).toHaveAttribute("aria-valuenow", "0");
    unmount();

    const big = item();
    big.meta.size = 41 * 1024 * 1024;
    setState({ items: [big] });
    render(<ImagesSection />);

    expect(
      screen.getByRole("progressbar", {
        name: i18n.t("options.images.totalStorage"),
      })
    ).toHaveAttribute("aria-valuenow", "82");
    expect(screen.getByText(/41984\.0 \/ 51200 KB/)).toBeInTheDocument();
  });

  it("saves alt text on click and on Enter, then clears the saved flash", async () => {
    setState({ items: [item()], altDraft: { "img-1": "new alt" } });
    render(<ImagesSection />);

    const input = screen.getByRole("textbox", {
      name: i18n.t("options.images.altText.label"),
    });
    fireEvent.change(input, { target: { value: "edited" } });
    expect(mocks.setAltDraft).toHaveBeenCalledWith("img-1", "edited");

    const save = screen.getByRole("button", { name: i18n.t("common.save") });
    await act(async () => {
      fireEvent.click(save);
      await Promise.resolve();
    });

    expect(mocks.saveAlt).toHaveBeenCalledWith("img-1");
    expect(savedFlashTimers).toHaveLength(1);

    await act(async () => {
      savedFlashTimers[0]?.();
    });
    expect(mocks.clearAltSaved).toHaveBeenCalledWith("img-1");

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
      await Promise.resolve();
    });
    expect(mocks.saveAlt).toHaveBeenCalledTimes(2);
  });

  it("does not schedule a saved flash when the alt write fails", async () => {
    mocks.saveAlt.mockResolvedValue(false);
    setState({ items: [item()] });
    render(<ImagesSection />);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: i18n.t("common.save") })
      );
      await Promise.resolve();
    });

    expect(savedFlashTimers).toHaveLength(0);
    expect(mocks.clearAltSaved).not.toHaveBeenCalled();
  });

  it("confirms deletion with the reference count and supports every exit", () => {
    setState({ items: [item()], confirmDeleteId: "img-1" });
    const { unmount } = render(<ImagesSection />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(
      i18n.t("options.images.deleteConfirmMessage", [1])
    );

    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("common.cancel") })
    );
    expect(mocks.cancelDelete).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(dialog.parentElement as HTMLElement, { key: "Escape" });
    expect(mocks.cancelDelete).toHaveBeenCalledTimes(2);

    fireEvent.click(
      screen.getByRole("button", {
        name: i18n.t("options.images.deleteButton"),
      })
    );
    expect(mocks.removeMedia).toHaveBeenCalledWith("img-1");
    unmount();

    setState({
      items: [item({ referencingSnippets: [] })],
      confirmDeleteId: "img-1",
    });
    render(<ImagesSection />);
    expect(screen.getByRole("dialog")).toHaveTextContent(
      i18n.t("options.images.deleteConfirmMessageNoRefs")
    );
  });

  it("does not open a confirmation for an id with no matching image", () => {
    setState({ items: [item()], confirmDeleteId: "missing" });

    render(<ImagesSection />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
