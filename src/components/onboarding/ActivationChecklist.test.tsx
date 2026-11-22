import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActivationChecklist } from "./ActivationChecklist";
import { guidedOnboardingStateItem } from "@/storage/items";
import { resetActivationForTests } from "@/store/activation";
import type { Snippet } from "@/types";
import { resetBrowserMocks } from "../../../tests/mocks/browser";

function snippet(overrides: Partial<Snippet> = {}): Snippet {
  return {
    id: "s1",
    label: "Signature",
    shortcut: "/sig",
    content: "Regards",
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    usageCount: 0,
    ...overrides,
  };
}

async function seed(value: Record<string, unknown>): Promise<void> {
  await browser.storage.local.set(value);
}

async function seedCompleted(
  value: Record<string, unknown> = {}
): Promise<void> {
  await seed({ guidedOnboarding: { status: "completed" }, ...value });
}

function doneState(testId: string): string | null {
  return screen.getByTestId(testId).getAttribute("data-done");
}

describe("ActivationChecklist", () => {
  beforeEach(() => {
    resetBrowserMocks();
    resetActivationForTests();
  });

  afterEach(() => {
    resetActivationForTests();
  });

  it("shows all three undone steps after the tour", async () => {
    await seedCompleted();

    render(<ActivationChecklist snippets={[]} />);

    await waitFor(() =>
      expect(screen.getByTestId("activation-checklist")).toBeVisible()
    );
    expect(screen.getByTestId("activation-progress")).toHaveTextContent(
      "0 of 3"
    );
    expect(doneState("activation-step-create")).toBe("false");
    expect(doneState("activation-step-placeholder")).toBe("false");
    expect(doneState("activation-step-insert")).toBe("false");
  });

  it("derives the create and placeholder steps from the library", async () => {
    await seedCompleted();

    render(<ActivationChecklist snippets={[snippet()]} />);

    await waitFor(() =>
      expect(doneState("activation-step-create")).toBe("true")
    );
    expect(doneState("activation-step-placeholder")).toBe("false");
  });

  it("marks the placeholder step from a snippet content token", async () => {
    await seedCompleted();

    render(
      <ActivationChecklist
        snippets={[snippet({ content: "Regards {{cursor}}" })]}
      />
    );

    await waitFor(() =>
      expect(doneState("activation-step-placeholder")).toBe("true")
    );
    expect(screen.getByTestId("activation-progress")).toHaveTextContent(
      "2 of 3"
    );
  });

  it("marks insertion from a used snippet still in the library", async () => {
    await seedCompleted({ snippetUsageCount: { s1: 1 } });

    render(
      <ActivationChecklist
        snippets={[snippet({ content: "Regards {{cursor}}" })]}
      />
    );

    await waitFor(() =>
      expect(screen.queryByTestId("activation-checklist")).toBeNull()
    );
  });

  it("starts over when the used snippet has been deleted", async () => {
    // The lifetime counter remains 1, but no current snippet has been used.
    await seedCompleted({
      totalSnippetInsertions: 1,
      snippetUsageCount: { "deleted-snippet": 1 },
    });

    render(<ActivationChecklist snippets={[]} />);

    await waitFor(() =>
      expect(screen.getByTestId("activation-checklist")).toBeVisible()
    );
    expect(screen.getByTestId("activation-progress")).toHaveTextContent(
      "0 of 3"
    );
    expect(doneState("activation-step-placeholder")).toBe("false");
    expect(doneState("activation-step-insert")).toBe("false");
  });

  it("does not render while the tour is still in progress", async () => {
    await seed({
      guidedOnboarding: { status: "in_progress", surface: "popup", step: 2 },
    });

    render(<ActivationChecklist snippets={[]} />);

    await waitFor(() =>
      expect(guidedOnboardingStateItem.getValue).toHaveBeenCalled()
    );
    expect(screen.queryByTestId("activation-checklist")).toBeNull();
  });

  it("does not render for a user who dismissed it", async () => {
    await seedCompleted({ activationDismissed: true });

    render(<ActivationChecklist snippets={[]} />);

    await waitFor(() =>
      expect(guidedOnboardingStateItem.getValue).toHaveBeenCalled()
    );
    expect(screen.queryByTestId("activation-checklist")).toBeNull();
  });

  it("dismisses on click and stays dismissed on the next mount", async () => {
    await seedCompleted();
    const user = userEvent.setup();

    const first = render(<ActivationChecklist snippets={[]} />);
    await waitFor(() =>
      expect(screen.getByTestId("activation-checklist")).toBeVisible()
    );
    await user.click(screen.getByTestId("activation-dismiss"));

    await waitFor(() =>
      expect(screen.queryByTestId("activation-checklist")).toBeNull()
    );
    expect(await browser.storage.local.get("activationDismissed")).toEqual({
      activationDismissed: true,
    });

    first.unmount();
    vi.mocked(guidedOnboardingStateItem.getValue).mockClear();
    render(<ActivationChecklist snippets={[]} />);

    await waitFor(() =>
      expect(guidedOnboardingStateItem.getValue).toHaveBeenCalled()
    );
    expect(screen.queryByTestId("activation-checklist")).toBeNull();
  });
});
