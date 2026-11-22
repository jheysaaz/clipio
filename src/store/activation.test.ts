import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";

import {
  activationDismissedItem,
  guidedOnboardingStateItem,
  usageCountsItem,
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
      snippetUsageCount: {
        s1: 3,
        s2: 0,
        s3: -1,
        s4: "many",
        s5: Number.POSITIVE_INFINITY,
      },
      activationDismissed: true,
    });

    await loadActivation();

    expect(activationStore.state).toEqual({
      onboarding: { status: "completed" },
      usageCounts: { s1: 3 },
      dismissed: true,
      isLoaded: true,
    });
  });

  it("repairs corrupt persisted values instead of showing a half-state", async () => {
    await seed({
      guidedOnboarding: { status: "nonsense" },
      snippetUsageCount: "many",
      activationDismissed: "yes",
    });

    await loadActivation();

    expect(activationStore.state.onboarding).toEqual({ status: "not_started" });
    expect(activationStore.state.usageCounts).toEqual({});
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
    expect(activationStore.state.usageCounts).toEqual({});
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

  it("reacts to an insertion recorded in another context", async () => {
    await loadActivation();

    await usageCountsItem.setValue({ s1: 2 });

    await waitFor(() =>
      expect(activationStore.state.usageCounts).toEqual({ s1: 2 })
    );
  });

  it("reacts to a dismissal made in another context", async () => {
    await loadActivation();

    await activationDismissedItem.setValue(true);

    await waitFor(() => expect(activationStore.state.dismissed).toBe(true));
  });

  it.each([
    "many",
    [1, 2],
    { s1: "many", s2: -1, s3: Number.POSITIVE_INFINITY },
  ])("ignores a non-positive or non-finite usage value: %s", async (value) => {
    await loadActivation();

    await usageCountsItem.setValue(value as never);

    expect(activationStore.state.usageCounts).toEqual({});
  });

  it("does not overwrite a stored dismissal when its write fails", async () => {
    vi.spyOn(activationDismissedItem, "setValue").mockRejectedValueOnce(
      new Error("write failed")
    );

    await dismissActivation();

    expect(activationStore.state.dismissed).toBe(true);
  });

  it("reads the per-snippet usage item it claims to read", async () => {
    await seed({ snippetUsageCount: { s1: 9 } });
    vi.spyOn(usageCountsItem, "getValue");

    await loadActivation();

    expect(usageCountsItem.getValue).toHaveBeenCalled();
  });
});
