import { describe, expect, it } from "vitest";

import { badgeForStorageState } from "./storage-badge";

describe("badgeForStorageState", () => {
  it("badges a refused write even while sync is still the active mode", () => {
    expect(
      badgeForStorageState({
        mode: "sync",
        quotaExceeded: false,
        localReason: "manual",
        attention: true,
      })
    ).toEqual({ text: "!", color: "#b91c1c" });
  });

  it("badges an automatic quota fallback", () => {
    expect(
      badgeForStorageState({
        mode: "local",
        quotaExceeded: true,
        localReason: "quota",
        attention: false,
      })
    ).toEqual({ text: "!", color: "#b91c1c" });
  });

  it("leaves a manual local-only choice unbadged", () => {
    expect(
      badgeForStorageState({
        mode: "local",
        quotaExceeded: false,
        localReason: "manual",
        attention: false,
      })
    ).toBeNull();
  });

  it("leaves healthy sync unbadged", () => {
    expect(
      badgeForStorageState({
        mode: "sync",
        quotaExceeded: false,
        localReason: "quota",
        attention: false,
      })
    ).toBeNull();
  });
});
