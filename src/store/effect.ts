/**
 * A tiny effect primitive over `Store.subscribe`.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Earlier drafts of this migration were written against TanStack Store's
 * `Effect` and `Derived` exports. **`@tanstack/store@0.11.2` ships neither.**
 * Its public surface is `Store` (with `setState` / `get` / `subscribe`),
 * `createAtom` for derived values, and the React bindings. So the two effects
 * this codebase wants — "when X changes, write Y" — are built here, on the
 * primitive that `Effect` was itself built on.
 *
 * The contract is the one `Effect` had, so the call sites read the same and
 * swapping in the real thing later is a one-line change:
 *
 *   - runs once immediately, then again whenever a watched field changes
 *   - runs again when the effect is re-registered with different deps
 *   - the returned function tears down the previous run
 */

import type { Store } from "@tanstack/store";

/**
 * Watch selected fields of a store and run a side effect when they change.
 *
 * @param deps Field names to watch. The effect runs once on registration and
 *   then only when one of these differs from the previous state — comparing
 * * whole objects would fire on every unrelated write.
 * @returns A teardown that stops the effect and disposes its subscription.
 */
export function effectOn<T extends object>(
  store: Store<T>,
  deps: readonly (keyof T)[],
  effect: (state: T) => void | (() => void)
): () => void {
  let previous: Pick<T, keyof T> | null = null;
  let cleanup: void | (() => void);

  const run = (state: T) => {
    const next = pick(state, deps);
    if (previous && shallowEqual(previous, next)) return;
    previous = next;
    if (typeof cleanup === "function") cleanup();
    cleanup = effect(state);
  };

  run(store.state);
  const subscription = store.subscribe((state) => run(state));

  return () => {
    subscription.unsubscribe();
    if (typeof cleanup === "function") cleanup();
  };
}

function pick<T extends object, K extends keyof T>(
  state: T,
  keys: readonly K[]
): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) out[key] = state[key];
  return out;
}

/** Field-by-field comparison. Every field here is a primitive. */
function shallowEqual(a: object, b: object): boolean {
  const keys = Object.keys(a) as (keyof typeof a)[];
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.is(a[key], b[key]));
}
