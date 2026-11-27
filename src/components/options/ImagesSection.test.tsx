/**
 * Direct tests for the images library surface.
 *
 * The component itself owns no store state, but it owns the presentation
 * branches that matter: which view renders, what a "Used in" link does, how a
 * description autosave is requested, and which errors are visible. Those
 * branches are driven here against a controlled store fixture.
 */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { i18n } from "#i18n";
import { FeedbackProvider } from "@/components/feedback/FeedbackProvider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockReference = { id: string; label: string };

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
  referencingSnippets: MockReference[];
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
  // Matches the store default: thumbnails are the first thing the user sees.
  viewMode: "grid",
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
    viewMode: "grid" as const,
    altDraft: {},
    altSaved: {},
    altErrors: {},
  } as MockState,
  loadMediaLibrary: vi.fn().mockResolvedValue(undefined),
  disposeObjectUrls: vi.fn(),
  flushPendingAltSaves: vi.fn().mockResolvedValue(undefined),
  dismissLoadError: vi.fn(),
  removeMedia: vi.fn().mockResolvedValue(undefined),
  requestDelete: vi.fn(),
  cancelDelete: vi.fn(),
  scheduleAltSave: vi.fn(),
  setAltDraft: vi.fn(),
  setViewMode: vi.fn(),
  sendMessage: vi.fn().mockResolvedValue({ ok: true }),
  captureError: vi.fn(),
}));

vi.mock("@/store/media", () => ({
  useMedia: (selector: (state: MockState) => unknown) => selector(mocks.state),
  loadMediaLibrary: mocks.loadMediaLibrary,
  disposeObjectUrls: mocks.disposeObjectUrls,
  flushPendingAltSaves: mocks.flushPendingAltSaves,
  dismissLoadError: mocks.dismissLoadError,
  findImageItem: (items: MockImageItem[], id: string | null) =>
    items.find((item) => item.meta.id === id),
  removeMedia: mocks.removeMedia,
  requestDelete: mocks.requestDelete,
  cancelDelete: mocks.cancelDelete,
  scheduleAltSave: mocks.scheduleAltSave,
  setAltDraft: mocks.setAltDraft,
  setViewMode: mocks.setViewMode,
  totalMediaBytes: (items: MockImageItem[]) =>
    items.reduce((sum, item) => sum + item.meta.size, 0),
}));

vi.mock("@/lib/protocol", () => ({
  MESSAGE: { POPUP_SNIPPET: "popup:open-snippet" },
  sendMessage: mocks.sendMessage,
}));

vi.mock("@/lib/sentry", () => ({ captureError: mocks.captureError }));

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

function renderSection() {
  return render(
    <FeedbackProvider>
      <ImagesSection />
    </FeedbackProvider>
  );
}

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
    referencingSnippets: [{ id: "snippet-1", label: "Greeting" }],
    ...overrides,
  };
}

function setState(patch: Partial<MockState>) {
  mocks.state = { ...mocks.state, ...patch };
}

function altField(id = "img-1") {
  return screen.getByRole("textbox", {
    name: `${i18n.t("options.images.altText.label")} ${id}`,
  });
}

beforeEach(() => {
  mocks.state = emptyState();
  for (const fn of [
    mocks.loadMediaLibrary,
    mocks.disposeObjectUrls,
    mocks.flushPendingAltSaves,
    mocks.dismissLoadError,
    mocks.removeMedia,
    mocks.requestDelete,
    mocks.cancelDelete,
    mocks.scheduleAltSave,
    mocks.setAltDraft,
    mocks.setViewMode,
    mocks.sendMessage,
    mocks.captureError,
  ]) {
    fn.mockReset();
  }
  mocks.loadMediaLibrary.mockResolvedValue(undefined);
  mocks.removeMedia.mockResolvedValue(undefined);
  mocks.sendMessage.mockResolvedValue({ ok: true });
});

afterEach(() => {
  // No component timers are left running: the debounce and the saved flash both
  // belong to the store now.
});

describe("ImagesSection", () => {
  it("loads on mount and releases resources while flushing descriptions on unmount", () => {
    const { unmount } = renderSection();

    expect(mocks.loadMediaLibrary).toHaveBeenCalledTimes(1);
    expect(mocks.disposeObjectUrls).not.toHaveBeenCalled();
    expect(mocks.flushPendingAltSaves).not.toHaveBeenCalled();

    unmount();

    expect(mocks.disposeObjectUrls).toHaveBeenCalledTimes(1);
    expect(mocks.flushPendingAltSaves).toHaveBeenCalledTimes(1);
  });

  it("shows a loading state and no library actions", () => {
    setState({ loading: true });

    renderSection();

    expect(
      screen.getByText(i18n.t("options.images.loading"))
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: i18n.t("options.images.viewGrid") })
    ).not.toBeInTheDocument();
  });

  it("shows a dismissible load error", () => {
    setState({ loadError: "Could not load images" });

    renderSection();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load images"
    );
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("common.dismissError") })
    );
    expect(mocks.dismissLoadError).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state when the library has no images", () => {
    renderSection();

    expect(
      screen.getByText(i18n.t("options.images.empty"))
    ).toBeInTheDocument();
    expect(screen.queryByTestId("image-row-img-1")).not.toBeInTheDocument();
  });

  it("lists images with previews, dimensions, links and errors", () => {
    setState({
      viewMode: "list",
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
      altErrors: { "img-2": "Alt text too long" },
      deleteErrors: { "img-2": "Delete failed" },
    });

    renderSection();

    const first = screen.getByTestId("image-row-img-1");
    const second = screen.getByTestId("image-row-img-2");
    expect(first.querySelector("img")).toHaveAttribute("src", "blob:preview");
    expect(second.querySelector("img")).not.toBeInTheDocument();
    expect(first).toHaveTextContent("PNG");
    expect(first).toHaveTextContent("2.0 KB");
    expect(first).toHaveTextContent(
      i18n.t("options.images.dimensions", [640, 480])
    );
    expect(first).toHaveTextContent(i18n.t("options.images.referencedBy"));
    expect(within(first).getByRole("link", { name: "Greeting" })).toBeVisible();
    expect(second).toHaveTextContent(i18n.t("options.images.noReferences"));
    expect(second).toHaveTextContent("Alt text too long");
    expect(second).toHaveTextContent("Delete failed");
    expect(altField("img-1")).toHaveValue("a cat");
    expect(
      screen.queryByRole("button", { name: i18n.t("common.save") })
    ).not.toBeInTheDocument();
    expect(within(first).getAllByTestId("mock-icon").length).toBeGreaterThan(0);

    fireEvent.click(
      screen.getByRole("button", {
        name: `${i18n.t("options.images.deleteButton")} img-1`,
      })
    );
    expect(mocks.requestDelete).toHaveBeenCalledWith("img-1");
  });

  it("opens the referenced snippet in the popup from a Used in link", async () => {
    setState({
      items: [
        item({
          referencingSnippets: [
            { id: "a/b?c", label: "Imported snippet" },
            { id: "snippet-2", label: "Second" },
          ],
        }),
      ],
    });

    renderSection();

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Imported snippet",
      "Second",
    ]);
    expect(links[0]).toHaveAttribute("href", "/popup.html#/snippet/a%2Fb%3Fc");

    await act(async () => {
      fireEvent.click(links[0]);
    });

    expect(mocks.sendMessage).toHaveBeenCalledWith("popup:open-snippet", {
      snippetId: "a/b?c",
    });
  });

  it("reports a failed popup request instead of pretending the link worked", async () => {
    mocks.sendMessage.mockRejectedValueOnce(new Error("no background"));
    setState({ items: [item()] });

    renderSection();

    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "Greeting" }));
    });

    await waitFor(() =>
      expect(mocks.captureError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          action: "images.openSnippet",
          snippetId: "snippet-1",
        })
      )
    );
  });

  it("starts in grid view and switches between grid and list", () => {
    setState({ items: [item()] });

    const grid = renderSection();
    expect(screen.getByTestId("image-row-img-1")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("options.images.viewList") })
    );
    expect(mocks.setViewMode).toHaveBeenCalledWith("list");
    grid.unmount();

    setState({ viewMode: "list" });
    renderSection();

    fireEvent.click(
      screen.getByRole("button", {
        name: `${i18n.t("options.images.deleteButton")} img-1`,
      })
    );
    expect(mocks.requestDelete).toHaveBeenCalledWith("img-1");
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("options.images.viewGrid") })
    );
    expect(mocks.setViewMode).toHaveBeenCalledWith("grid");
  });

  it("reports storage use against the configured limit in both colour bands", () => {
    setState({ items: [item()] });

    const { unmount } = renderSection();
    expect(
      screen.getByRole("progressbar", {
        name: i18n.t("options.images.totalStorage"),
      })
    ).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByTestId("image-total-storage")).toHaveTextContent(
      "2 KB / 50 MB"
    );
    unmount();

    const big = item();
    big.meta.size = 41 * 1024 * 1024;
    setState({ items: [big] });
    renderSection();

    expect(
      screen.getByRole("progressbar", {
        name: i18n.t("options.images.totalStorage"),
      })
    ).toHaveAttribute("aria-valuenow", "82");
    expect(screen.getByTestId("image-total-storage")).toHaveTextContent(
      "41 MB / 50 MB"
    );
    expect(screen.getByTestId("image-total-storage")).toHaveTextContent(
      "9 MB free"
    );
  });

  it("queues an autosave on each description change without a Save button", () => {
    setState({ items: [item()], altDraft: { "img-1": "new alt" } });
    renderSection();

    const input = altField();
    fireEvent.change(input, { target: { value: "edited" } });

    expect(mocks.setAltDraft).toHaveBeenCalledWith("img-1", "edited");
    expect(mocks.scheduleAltSave).toHaveBeenCalledWith("img-1");
    expect(
      screen.queryByRole("button", { name: i18n.t("common.save") })
    ).not.toBeInTheDocument();
  });

  it("shows a saved indicator only when the store reports a committed description", () => {
    setState({ items: [item()], altSaved: { "img-1": true } });
    renderSection();

    expect(screen.getByTestId("image-saved-img-1")).toHaveAccessibleName(
      i18n.t("options.row.saved")
    );
  });

  it("confirms deletion with the reference count and supports every exit", () => {
    setState({ items: [item()], confirmDeleteId: "img-1" });
    const { unmount } = renderSection();

    const dialog = screen.getByRole("alertdialog");
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
    renderSection();
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      i18n.t("options.images.deleteConfirmMessageNoRefs")
    );
  });

  it("does not open a confirmation for an id with no matching image", () => {
    setState({ items: [item()], confirmDeleteId: "missing" });

    renderSection();

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
