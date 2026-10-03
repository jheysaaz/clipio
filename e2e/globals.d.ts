/**
 * Ambient types for the e2e suite.
 *
 * WHY THIS FILE EXISTS
 *
 * `tsconfig.e2e.json` existed but was referenced by nothing — not by
 * `package.json`, not by CI, not by any doc. It named `e2e/**\/*.ts`, so the
 * Playwright suite that gates every release was never type-checked at all. It
 * accumulated eight errors, including two that had been silently doing nothing
 * at runtime: `toBeVisible({ message: … })` in
 * `contenteditable-multinode.spec.ts`, where Playwright 1.61 accepts only
 * `timeout` and `visible`. JavaScript happily ignores an unknown option, so the
 * diagnostics those calls carried were never displayed to anyone. That is the
 * whole argument for wiring the config in — the errors were not cosmetic.
 *
 * WHAT THIS DECLARES
 *
 * `chrome` inside `page.evaluate(…)`. The callback is serialised and executed
 * *inside the browser*, where `chrome.storage` exists on an extension page and
 * does not exist on an ordinary HTTP page. The Node-side TypeScript program has
 * no `chrome` global, so referencing it there is a legitimate error even though
 * the reference is correct at runtime.
 *
 * This declares a narrow, honest surface — only the members the suite actually
 * touches — rather than pulling in full web-extension typings that would imply
 * far more surface than is verified. If a test starts using a member that is not
 * declared here, that is a compile error asking for a deliberate decision
 * rather than an implicit `any`.
 *
 * Note that `typeof chrome !== "undefined"` guards stay legal and still work:
 * `typeof` on a declared global does not throw.
 */

/** The subset of `chrome.storage` the e2e helpers probe for. */
declare namespace chrome {
  namespace storage {
    namespace local {
      function get(keys?: unknown): Promise<Record<string, unknown>>;
      function set(items: Record<string, unknown>): Promise<void>;
      function remove(keys: unknown): Promise<void>;
    }
  }
}
