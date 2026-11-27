import { describe, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
import { getOrCreateRoot } from "./react-root";

function fakeRoot(): Root {
  return { render: vi.fn(), unmount: vi.fn() } as unknown as Root;
}

describe("getOrCreateRoot", () => {
  it("creates once and reuses the root when the entrypoint runs again", () => {
    const host: { __clipioReactRoot?: Root } = {};
    const root = fakeRoot();
    const create = vi.fn(() => root);

    expect(getOrCreateRoot(host, create)).toBe(root);
    expect(getOrCreateRoot(host, create)).toBe(root);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not share a root between two containers", () => {
    const first: { __clipioReactRoot?: Root } = {};
    const second: { __clipioReactRoot?: Root } = {};
    const firstRoot = fakeRoot();
    const secondRoot = fakeRoot();

    expect(getOrCreateRoot(first, () => firstRoot)).toBe(firstRoot);
    expect(getOrCreateRoot(second, () => secondRoot)).toBe(secondRoot);
    expect(first.__clipioReactRoot).toBe(firstRoot);
    expect(second.__clipioReactRoot).toBe(secondRoot);
  });
});
