/**
 * The options page's not-found view.
 *
 * Replaces behaviour that was actively misleading: `sectionFromHash` rejected an
 * unrecognised hash and fell back to `library`, so a stale link, a renamed
 * section, or a typo all produced a page that looked like it had loaded. Nothing
 * distinguished "here is the Library" from "I have no idea what you asked for".
 *
 * The route tree now knows exactly which paths exist, so this only appears for a
 * genuinely unknown one — which makes it worth showing rather than swallowing.
 */

import { Link } from "@tanstack/react-router";

import { i18n } from "#i18n";

export function OptionsNotFound() {
  return (
    <div
      data-testid="options-not-found"
      className="py-16 text-center"
      role="region"
      aria-label={i18n.t("options.notFound.title")}
    >
      <h1 className="text-lg font-semibold text-foreground">
        {i18n.t("options.notFound.title")}
      </h1>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        {i18n.t("options.notFound.body")}
      </p>
      {/* `to` is a literal route, so a rename is a compile error rather than a
          404 the user has to discover. `Button` has no `asChild`, so the link
          carries the button classes itself rather than nesting one element in
          another — two interactive elements in one is a keyboard trap. */}
      <Link
        to="/library"
        className="mt-5 inline-flex h-8 items-center justify-center rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground hover:bg-primary/90"
      >
        {i18n.t("options.notFound.action")}
      </Link>
    </div>
  );
}
