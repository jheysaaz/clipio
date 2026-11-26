import { afterEach, describe, expect, it, vi } from "vitest";
import { withQueueLock } from "./queue-lock";

const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalLocks) {
    Object.defineProperty(navigator, "locks", originalLocks);
  } else {
    Reflect.deleteProperty(navigator, "locks");
  }
});

describe("withQueueLock", () => {
  it("uses the cross-context Web Lock when the browser provides it", async () => {
    const request = vi.fn(async (_name: string, run: () => Promise<number>) =>
      run()
    );
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request },
    });

    await expect(withQueueLock(async () => 42)).resolves.toBe(42);
    expect(request).toHaveBeenCalledWith(
      "clipio:write-queue",
      expect.any(Function)
    );
  });

  it("serialises overlapping writers when Web Locks are unavailable", async () => {
    Reflect.deleteProperty(navigator, "locks");
    const order: string[] = [];
    let releaseFirst: (() => void) | null = null;

    const first = withQueueLock(async () => {
      order.push("first:start");
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      order.push("first:end");
    });
    const second = withQueueLock(async () => {
      order.push("second");
    });

    // Let the first callback reach its await before deciding the second ran.
    await Promise.resolve();
    expect(order).toEqual(["first:start"]);

    releaseFirst!();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("releases the fallback lock after a failure", async () => {
    Reflect.deleteProperty(navigator, "locks");

    await expect(
      withQueueLock(async () => {
        throw new Error("denied");
      })
    ).rejects.toThrow("denied");
    await expect(withQueueLock(async () => "next")).resolves.toBe("next");
  });
});
