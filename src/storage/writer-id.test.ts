import { describe, it, expect, beforeEach, vi } from "vitest";
import { writerIdItem } from "./items";
import { getWriterId } from "./writer-id";

describe("getWriterId", () => {
  beforeEach(() => {
    vi.mocked(writerIdItem.getValue).mockReset();
    vi.mocked(writerIdItem.setValue).mockReset();
    vi.mocked(writerIdItem.getValue).mockResolvedValue("unknown");
    vi.mocked(writerIdItem.setValue).mockResolvedValue(undefined);
  });

  it("creates and persists a stable id on first use", async () => {
    const id = await getWriterId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(writerIdItem.setValue).toHaveBeenCalledWith(id);
  });

  it("reuses an existing id without writing", async () => {
    vi.mocked(writerIdItem.getValue).mockResolvedValue("device-123");
    expect(await getWriterId()).toBe("device-123");
    expect(writerIdItem.setValue).not.toHaveBeenCalled();
  });

  it("replaces the legacy sentinel", async () => {
    vi.mocked(writerIdItem.getValue).mockResolvedValue("unknown");
    expect(await getWriterId()).not.toBe("unknown");
  });
});
