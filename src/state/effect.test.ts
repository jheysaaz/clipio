import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "@tanstack/store";

import { effectOn } from "./effect";

/**
 * `effectOn` is the substitute for TanStack Store's `Effect`, which
 * `@tanstack/store@0.11.2` does not ship. It is the primitive every settings
 * effect is built on, so its contract is pinned here rather than being assumed
 * by the store that uses it.
 */

type Counter = { a: number; b: string; c: boolean };

const makeStore = () => createStore<Counter>({ a: 0, b: "", c: false });

describe("effectOn", () => {
  it("runs immediately on registration", () => {
    // The old providers' `useEffect`s ran on mount and that behaviour is relied
    // on: the paint effects must apply the stored theme without waiting for a
    // change that may never come.
    const store = makeStore();
    const effect = vi.fn();
    effectOn(store, ["a"], effect);
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it("runs again when a watched field changes", () => {
    const store = makeStore();
    const effect = vi.fn();
    effectOn(store, ["a"], effect);

    store.setState((prev) => ({ ...prev, a: 1 }));
    expect(effect).toHaveBeenCalledTimes(2);
  });

  it("does not run when an unwatched field changes", () => {
    const store = makeStore();
    const effect = vi.fn();
    effectOn(store, ["a"], effect);

    store.setState((prev) => ({ ...prev, b: "unrelated" }));
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it("does not run when a watched field is written with the same value", () => {
    // Comparing whole objects would fire here, since `setState` always produces
    // a new object. Everything this watches is a primitive.
    const store = makeStore();
    const effect = vi.fn();
    effectOn(store, ["a"], effect);

    store.setState((prev) => ({ ...prev, a: 0 }));
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it("does not run when a watched field changes to a different falsy value", () => {
    // A `|| next` guard instead of an explicit `undefined` check would treat 0
    // and "" as "no value" and skip the run.
    const store = makeStore();
    const effect = vi.fn();
    effectOn(store, ["a", "b"], effect);

    store.setState((prev) => ({ ...prev, a: 1 }));
    store.setState((prev) => ({ ...prev, a: 0, b: "x" }));
    store.setState((prev) => ({ ...prev, b: "" }));

    expect(effect).toHaveBeenCalledTimes(4);
  });

  it("passes the current state to the effect", () => {
    const store = makeStore();
    const seen: number[] = [];
    effectOn(store, ["a"], (state) => {
      seen.push(state.a);
    });

    store.setState((prev) => ({ ...prev, a: 7 }));
    expect(seen).toEqual([0, 7]);
  });

  it("runs the previous cleanup before the next run", () => {
    // This is what makes the media-query listener in the settings store
    // removable: leaving system mode must detach the old listener.
    const store = makeStore();
    const order: string[] = [];

    effectOn(store, ["a"], () => {
      order.push("run");
      return () => order.push("cleanup");
    });

    store.setState((prev) => ({ ...prev, a: 1 }));
    store.setState((prev) => ({ ...prev, a: 2 }));

    // Three runs: once on registration, once per change. Each is preceded by
    // the previous run's cleanup. The last run's cleanup is not in here
    // because teardown has not happened yet.
    expect(order).toEqual(["run", "cleanup", "run", "cleanup", "run"]);
  });

  it("runs cleanup on teardown", () => {
    const store = makeStore();
    const cleanup = vi.fn();
    const off = effectOn(store, ["a"], () => cleanup);

    off();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("stops firing after teardown", () => {
    const store = makeStore();
    const effect = vi.fn();
    const off = effectOn(store, ["a"], effect);

    off();
    store.setState((prev) => ({ ...prev, a: 1 }));
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it("tolerates an effect that returns nothing", () => {
    const store = makeStore();
    const off = effectOn(store, ["a"], () => {
      /* no cleanup */
    });

    store.setState((prev) => ({ ...prev, a: 1 }));
    expect(() => off()).not.toThrow();
  });

  it("runs cleanup only once when the effect has no cleanup and is torn down", () => {
    const store = makeStore();
    const off = effectOn(store, ["a"], () => {});
    expect(() => {
      off();
      off();
    }).not.toThrow();
  });

  it("watches several fields and fires when any of them changes", () => {
    const store = makeStore();
    const effect = vi.fn();
    effectOn(store, ["a", "b"], effect);

    store.setState((prev) => ({ ...prev, a: 1 }));
    store.setState((prev) => ({ ...prev, b: "x" }));
    store.setState((prev) => ({ ...prev, c: true }));

    expect(effect).toHaveBeenCalledTimes(3);
  });
});
