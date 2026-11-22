/**
 * Direct tests for the options rail.
 *
 * The rail owns three behaviours the section content cannot cover: the search
 * keyboard flow, the grouped nav projection, and the shortcut hint. Each is
 * driven through the DOM here rather than inferred from the registry tests.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { i18n } from "#i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";

const mocks = vi.hoisted(() => ({ currentPlatform: vi.fn(() => "mac") }));

vi.mock("@/lib/shortcuts", () => ({ currentPlatform: mocks.currentPlatform }));

import { SettingsSidebar } from "./SettingsSidebar";
import { searchRegistryEntries } from "./search";
import { resetActivationForTests } from "@/store/activation";
import { resetSnippetsStoreForTests } from "@/store/snippets";
import { resetBrowserMocks } from "../../../../tests/mocks/browser";

type Props = ComponentProps<typeof SettingsSidebar>;

function renderSidebar(overrides: Partial<Props> = {}) {
  const props: Props = {
    activeSection: "library",
    onNavigate: vi.fn(),
    query: "",
    onQueryChange: vi.fn(),
    onPickSetting: vi.fn(),
    width: 256,
    onWidthChange: vi.fn(),
    ...overrides,
  };
  const view = render(<SettingsSidebar {...props} />);
  return { props, ...view };
}

function searchInput() {
  return screen.getByRole("searchbox", {
    name: i18n.t("options.search.label"),
  });
}

beforeEach(() => {
  mocks.currentPlatform.mockReturnValue("mac");
  resetBrowserMocks();
  resetActivationForTests();
  resetSnippetsStoreForTests();
});

afterEach(() => {
  mocks.currentPlatform.mockReset();
  resetActivationForTests();
  resetSnippetsStoreForTests();
});

describe("SettingsSidebar", () => {
  it("renders the registry nav in groups and marks the active section", () => {
    renderSidebar();

    expect(screen.queryByTestId("activation-checklist")).toBeNull();
    expect(
      screen.getByRole("navigation", {
        name: i18n.t("options.a11y.optionsNav"),
      })
    ).toBeInTheDocument();
    for (const key of [
      "options.groups.library",
      "options.groups.behaviour",
      "options.groups.appearance",
      "options.groups.system",
    ] as const) {
      expect(screen.getAllByText(i18n.t(key)).length).toBeGreaterThan(0);
    }

    expect(screen.getByTestId("options-nav-library")).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByTestId("options-nav-images")).not.toHaveAttribute(
      "aria-current"
    );
    expect(screen.getByRole("separator")).toHaveAttribute(
      "aria-valuenow",
      "256"
    );
  });

  it("navigates to the clicked section", () => {
    const { props } = renderSidebar();

    fireEvent.click(screen.getByTestId("options-nav-images"));

    expect(props.onNavigate).toHaveBeenCalledTimes(1);
    expect(props.onNavigate).toHaveBeenCalledWith("images");
  });

  it("keeps the nav visible for whitespace-only queries", () => {
    renderSidebar({ query: "   " });

    expect(screen.getByTestId("options-nav")).toContainElement(
      screen.getByTestId("options-nav-library")
    );
  });

  it("hides the nav while searching and opens the first match on Enter", () => {
    const first = searchRegistryEntries("theme")[0];
    expect(first).toBeDefined();
    const { props } = renderSidebar({ query: "theme" });

    expect(screen.queryByTestId("options-nav-library")).not.toBeInTheDocument();

    fireEvent.keyDown(searchInput(), { key: "Enter" });

    expect(props.onPickSetting).toHaveBeenCalledWith(first?.entry);
  });

  it("does nothing on Enter when a query has no results", () => {
    const { props } = renderSidebar({ query: "no-such-setting-at-all" });

    fireEvent.keyDown(searchInput(), { key: "Enter" });

    expect(props.onPickSetting).not.toHaveBeenCalled();
  });

  it("moves focus from the query field into the first result", () => {
    const first = searchRegistryEntries("theme")[0];
    expect(first).toBeDefined();
    render(
      <>
        <button data-testid={`option-setting-${first?.entry.id}`} type="button">
          result
        </button>
        <SettingsSidebar
          activeSection="library"
          onNavigate={vi.fn()}
          query="theme"
          onQueryChange={vi.fn()}
          onPickSetting={vi.fn()}
          width={256}
          onWidthChange={vi.fn()}
        />
      </>
    );

    fireEvent.keyDown(searchInput(), { key: "ArrowDown" });

    expect(
      screen.getByTestId(`option-setting-${first?.entry.id}`)
    ).toHaveFocus();
  });

  it("clears and blurs the query field on Escape", () => {
    const { props } = renderSidebar({ query: "theme" });
    const input = searchInput();
    input.focus();

    fireEvent.keyDown(input, { key: "Escape" });

    expect(props.onQueryChange).toHaveBeenCalledWith("");
    expect(input).not.toHaveFocus();
  });

  it("focuses and selects the search field on Ctrl+K and Meta+K", () => {
    renderSidebar({ query: "theme" });
    const input = searchInput() as HTMLInputElement;

    fireEvent.keyDown(document, { key: "K", ctrlKey: true });
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("theme".length);

    input.blur();
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(input).toHaveFocus();
  });

  it("uses / as a secondary shortcut only when not already typing", () => {
    renderSidebar();
    const input = searchInput();
    const other = document.createElement("input");
    document.body.appendChild(other);

    other.focus();
    fireEvent.keyDown(other, { key: "/" });
    expect(input).not.toHaveFocus();

    fireEvent.keyDown(document.body, { key: "/" });
    expect(input).toHaveFocus();

    other.remove();
  });

  it("advertises the platform's modifier and follows a platform change", () => {
    const { rerender } = renderSidebar();
    const hint = () =>
      screen
        .getByTestId("options-search")
        .parentElement?.querySelector("span[aria-hidden='true']");

    expect(hint()).toHaveTextContent("K");
    expect(hint()).not.toHaveTextContent("Ctrl");

    mocks.currentPlatform.mockReturnValue("win");
    rerender(
      <SettingsSidebar
        activeSection="library"
        onNavigate={vi.fn()}
        query=""
        onQueryChange={vi.fn()}
        onPickSetting={vi.fn()}
        width={256}
        onWidthChange={vi.fn()}
      />
    );

    expect(hint()).toHaveTextContent("Ctrl");
  });

  it("renders the first-success card beneath the nav when it is due", async () => {
    await browser.storage.local.set({
      guidedOnboarding: { status: "completed" },
      snippetUsageCount: {},
      activationDismissed: false,
    });

    renderSidebar();

    await waitFor(() =>
      expect(screen.getByTestId("activation-checklist")).toBeVisible()
    );
    expect(screen.getByTestId("options-nav")).toContainElement(
      screen.getByTestId("options-nav-library")
    );
    expect(screen.getByTestId("activation-dismiss")).toBeVisible();
  });
});
