/**
 * What a context-menu click means, separated from what it does.
 *
 * ── Why this is extracted ────────────────────────────────────────────────────
 *
 * The same reason as `sync-change.ts`: the decision lived inside a listener in
 * `src/entrypoints/background.ts`, which is on the coverage exclusion list, so
 * none of its branches were reachable from a test.
 *
 * It is not a hypothetical risk. One of these seven branches already shipped
 * broken: "Give feedback" pointed at `options.html#feedback`, which was never a
 * section id, so the options page rejected the hash and the user landed on
 * Library. The link worked and arrived somewhere else — the worst kind of bug,
 * because every layer above it reported success. The id is pinned in
 * `context-menu.test.ts` now.
 *
 * The split is deliberate: this module decides, `background.ts` does. So the
 * routing table can be asserted exhaustively — every id, every absent input — and
 * the side effects stay where the browser APIs are.
 */

import { CONTEXT_MENU } from "@/config/constants";

/** What the click was on. Mirrors the fields of `contextMenus.OnClickData`. */
export type ContextMenuClick = {
  menuItemId: string;
  /** The user's selection, when the menu was opened over one. */
  selectionText?: string;
  /** The page the click happened on, when there was one. */
  pageUrl?: string;
};

export type ContextMenuAction =
  /** Stash the selection, then open the popup. */
  | { kind: "save-selection"; text: string }
  /** Open the popup on a blank create form. */
  | { kind: "create-snippet" }
  /** Open the options page at its library section. */
  | { kind: "open-dashboard" }
  /** Open the options page at its feedback section. */
  | { kind: "open-feedback" }
  /** Add this host to the blocked-sites list. */
  | { kind: "hide-on-site"; hostname: string }
  /**
   * Nothing to do.
   *
   * A distinct kind rather than `null` so a caller that forgets a branch gets a
   * type error rather than a silent no-op — which is what a bare `null` return
   * invites.
   */
  | { kind: "none" };

/** The no-op action. A frozen constant so callers cannot mutate it. */
const NOTHING: ContextMenuAction = Object.freeze({ kind: "none" });

/**
 * Resolve a click to the action it means.
 *
 * @throws if `pageUrl` is present but unparseable. A malformed URL is a genuine
 *   fault worth reporting, not a reason to do nothing quietly — but the decision
 *   function stays pure, so the reporting happens in the caller.
 */
export function resolveContextMenuAction(
  click: ContextMenuClick
): ContextMenuAction {
  switch (click.menuItemId) {
    case CONTEXT_MENU.SAVE_SELECTION: {
      // Trimmed, and the emptiness checked after. The menu is offered on
      // selections, but a click can arrive with whitespace only — a click-drag
      // that caught a newline, or a host reporting an empty selection. Stashing
      // that would pre-fill the create form with whitespace and open the popup on
      // it.
      const text = click.selectionText?.trim();
      if (!text) return NOTHING;
      return { kind: "save-selection", text };
    }

    case CONTEXT_MENU.CREATE_SNIPPET:
      return { kind: "create-snippet" };

    case CONTEXT_MENU.OPEN_DASHBOARD:
      return { kind: "open-dashboard" };

    case CONTEXT_MENU.GIVE_FEEDBACK:
      return { kind: "open-feedback" };

    case CONTEXT_MENU.HIDE_ON_SITE: {
      // The menu is offered on any page, so there is always a URL in principle —
      // but not in practice: a click in a context where the browser does not
      // report one lands here with nothing to block.
      const url = click.pageUrl;
      if (!url) return NOTHING;
      return { kind: "hide-on-site", hostname: new URL(url).hostname };
    }

    default:
      // The parent and separator items are not clickable, and neither is an id
      // from a future build whose handler this one does not know. Doing nothing is
      // right for both; the important part is that it is a decision rather than
      // an oversight.
      return NOTHING;
  }
}

/**
 * The options-page route "Give feedback" opens.
 *
 * A real route, not a legacy hash. `#feedback` was never a section id, so the
 * options page rejected it and the user landed on Library — the link worked and
 * arrived somewhere else. `legacyHashRedirect` still handles the old string for
 * bookmarks; this stops producing new ones.
 *
 * Exported rather than inlined in `background.ts` so the test asserts the value
 * the code uses. Asserting a copy of it, the way the old e2e spec asserted a copy
 * of its menu ids, is what let the wrong hash survive.
 */
export const FEEDBACK_ROUTE = "#/about/feedback";

/** Every clickable menu id, so a new one cannot be added without a test. */
export const CLICKABLE_MENU_IDS: readonly string[] = [
  CONTEXT_MENU.SAVE_SELECTION,
  CONTEXT_MENU.CREATE_SNIPPET,
  CONTEXT_MENU.OPEN_DASHBOARD,
  CONTEXT_MENU.GIVE_FEEDBACK,
  CONTEXT_MENU.HIDE_ON_SITE,
];
