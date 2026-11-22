/**
 * The options rail wrapper is the only component that boots the snippets store
 * on this surface. These tests pin that wiring as well as the checklist's
 * placement-independent rendering: without the load, the card would claim the
 * user has no snippets even when their library is full.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ loadSnippets: vi.fn() }));

vi.mock("@/store/snippets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store/snippets")>();
  return {
    ...actual,
    loadSnippets: (...args: unknown[]) => mocks.loadSnippets(...args),
  };
});

import { ActivationChecklistCard } from "./ActivationChecklistCard";
import { guidedOnboardingStateItem } from "@/storage/items";
import { resetActivationForTests } from "@/store/activation";
import { resetSnippetsStoreForTests, snippetsStore } from "@/store/snippets";
import type { Snippet } from "@/types";
import { resetBrowserMocks } from "../../../../tests/mocks/browser";

function snippet(): Snippet {
  return {
    id: "s1",
    label: "Signature",
    shortcut: "/sig",
    content: "Regards {{cursor}}",
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    usageCount: 0,
  };
}

describe("ActivationChecklistCard", () => {
  beforeEach(() => {
    resetBrowserMocks();
    resetActivationForTests();
    resetSnippetsStoreForTests();
    mocks.loadSnippets.mockReset().mockImplementation(async () => {
      snippetsStore.setState((prev) => ({ ...prev, snippets: [snippet()] }));
    });
  });

  afterEach(() => {
    resetActivationForTests();
    resetSnippetsStoreForTests();
    mocks.loadSnippets.mockReset();
  });

  it("loads the library and derives the card from it", async () => {
    await browser.storage.local.set({
      guidedOnboarding: { status: "completed" },
      snippetUsageCount: {},
      activationDismissed: false,
    });

    render(<ActivationChecklistCard />);

    await waitFor(() =>
      expect(screen.getByTestId("activation-checklist")).toBeVisible()
    );
    expect(mocks.loadSnippets).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("activation-step-create")).toHaveAttribute(
      "data-done",
      "true"
    );
    expect(screen.getByTestId("activation-step-placeholder")).toHaveAttribute(
      "data-done",
      "true"
    );
    expect(screen.getByTestId("activation-progress")).toHaveTextContent(
      "2 of 3"
    );
  });

  it("stays hidden while the tour is in progress", async () => {
    await browser.storage.local.set({
      guidedOnboarding: {
        status: "in_progress",
        surface: "options",
        step: 0,
      },
    });

    render(<ActivationChecklistCard />);

    await waitFor(() =>
      expect(guidedOnboardingStateItem.getValue).toHaveBeenCalled()
    );
    expect(screen.queryByTestId("activation-checklist")).toBeNull();
  });
});
