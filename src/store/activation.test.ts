import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";

import {
  activationDismissedItem,
  guidedOnboardingStateItem,
  totalSnippetInsertionsItem,
} from "@/storage/items";
import { resetBrowserMocks } from "../../tests/mocks/browser";
import {
  activationStore,
  dismissActivation,
  loadActivation,
  resetActivationForTests,
} from "./activation";

async function seed(value: Record<string, unknown>): Promise<void> {
  await browser.storage.local.set(value);
}

describe("activation store", () => {
  beforeEach(() => {
    resetBrowserMocks();
    resetActivationForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetActivationForTests();
  });

  it("loads normalised persisted inputs", async () => {
    await seed({
      guidedOnboarding: { status: "completed" },
      totalSnippetInsertions: 4,
      activationDismissed: true,
    });

    await loadActivation();

    expect(activationStore.state).toEqual({
      onboarding: { status: "completed" },
      totalInsertions: 4,
      dismissed: true,
      isLoaded: true,
    });
  });

  it("repairs corrupt persisted values instead of showing a half-state", async () => {
    await seed({
      guidedOnboarding: { status: "nonsense" },
      totalSnippetInsertions: -8,
      activationDismissed: "yes",
    });

    await loadActivation();

    expect(activationStore.state.onboarding).toEqual({ status: "not_started" });
    expect(activationStore.state.totalInsertions).toBe(0);
    expect(activationStore.state.dismissed).toBe(false);
    expect(activationStore.state.isLoaded).toBe(true);
  });

  it("marks itself loaded when storage read fails", async () => {
    vi.spyOn(guidedOnboardingStateItem, "getValue").mockRejectedValueOnce(
      new Error("storage unavailable")
    );

    await loadActivation();

    expect(activationStore.state.isLoaded).toBe(true);
    expect(activationStore.state.onboarding).toEqual({ status: "not_started" });
  });

  it("dismisses immediately and persists the choice", async () => {
    await seed({ activationDismissed: false });
    await loadActivation();

    await dismissActivation();

    expect(activationStore.state.dismissed).toBe(true);
    expect(await activationDismissedItem.getValue()).toBe(true);
  });

  it("reacts to the tour ending in another context", async () => {
    await loadActivation();

    await guidedOnboardingStateItem.setValue({ status: "skipped" });

    await waitFor(() =>
      expect(activationStore.state.onboarding).toEqual({ status: "skipped" })
    );
  });

  it("reacts to an insertion counted in another context", async () => {
    await loadActivation();

    await totalSnippetInsertionsItem.setValue(2);

    await waitFor(() => expect(activationStore.state.totalInsertions).toBe(2));
  });

  it("reacts to a dismissal made in another context", async () => {
    await loadActivation();

    await activationDismissedItem.setValue(true);

    await waitFor(() => expect(activationStore.state.dismissed).toBe(true));
  });

  it("ignores an insertion count that is not a finite number", async () => {
    await loadActivation();

    await totalSnippetInsertionsItem.setValue("many" as never);

    expect(activationStore.state.totalInsertions).toBe(0);
  });

  it("does not overwrite a stored dismissal when its write fails", async () => {
    vi.spyOn(activationDismissedItem, "setValue").mockRejectedValueOnce(
      new Error("write failed")
    );

    await dismissActivation();

    expect(activationStore.state.dismissed).toBe(true);
  });

  it("reads the global insertion item it claims to read", async () => {
    await seed({ totalSnippetInsertions: 9 });
    vi.spyOn(totalSnippetInsertionsItem, "getValue");

    await loadActivation();

    expect(totalSnippetInsertionsItem.getValue).toHaveBeenCalled();
  });
});
