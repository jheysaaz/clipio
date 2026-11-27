/**
 * Windowed sidebar list.
 *
 * The library can be thousands of snippets; the sidebar can show a handful of
 * rows. Rendering every snippet used to make the popup's first commit — and
 * every search keystroke — walk the whole library. Here only the rows in the
 * viewport plus an overscan are mounted, with spacers holding the scroll height.
 *
 * All of the boundary arithmetic lives in `src/lib/virtual-list.ts`; this file
 * only measures the viewport and turns the slice into DOM.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { i18n } from "#i18n";

import SnippetListItem from "@/components/SnippetListItem";
import type { Snippet, SnippetFormData } from "@/types";
import { scrollTopForRow, virtualRange } from "@/lib/virtual-list";

/** Row (3rem) + the gap below it (0.5rem), both relative units. */
const ROW_STRIDE_REM = 3.5;
const OVERSCAN = 4;
const FALLBACK_VIEWPORT_HEIGHT = 480;

function remToPx(rem: number): number {
  if (typeof getComputedStyle === "undefined") return rem * 16;
  const rootSize = Number.parseFloat(
    getComputedStyle(document.documentElement).fontSize
  );
  return (Number.isFinite(rootSize) ? rootSize : 16) * rem;
}

export type SnippetListProps = {
  snippets: readonly Snippet[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isCreating: boolean;
  draft: SnippetFormData;
  /** Changes when the query changes, so the list starts from the top again. */
  resetKey: string;
};

export function SnippetList({
  snippets,
  selectedId,
  onSelect,
  isCreating,
  draft,
  resetKey,
}: SnippetListProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(
    FALLBACK_VIEWPORT_HEIGHT
  );
  const [rowHeight, setRowHeight] = useState(() => remToPx(ROW_STRIDE_REM));

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () =>
      setViewportHeight(viewport.clientHeight || FALLBACK_VIEWPORT_HEIGHT);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const resize = () => setRowHeight(remToPx(ROW_STRIDE_REM));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = 0;
    setScrollTop(0);
  }, [resetKey]);

  const selectedIndex = useMemo(
    () => snippets.findIndex((snippet) => snippet.id === selectedId),
    [snippets, selectedId]
  );

  const showDraft = isCreating && !!(draft.label || draft.shortcut);
  const headerHeight = showDraft ? rowHeight : 0;
  const range = virtualRange(
    snippets.length,
    Math.max(0, scrollTop - headerHeight),
    viewportHeight,
    rowHeight,
    OVERSCAN
  );

  // A selection made from the editor or by keyboard can be outside the window.
  // Scroll it into view when the selection changes, not on every scroll: a
  // user dragging the scrollbar must be able to leave the selected row behind.
  // The current scrollTop is read from the node so it cannot go stale here.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || selectedIndex < 0) return;
    const next = scrollTopForRow(
      selectedIndex,
      viewport.scrollTop,
      viewportHeight,
      rowHeight,
      headerHeight
    );
    if (next === null) return;
    viewport.scrollTop = next;
    setScrollTop(next);
  }, [selectedIndex, viewportHeight, rowHeight, headerHeight]);

  const rows = snippets.slice(range.start, range.end);

  return (
    <div
      ref={viewportRef}
      data-testid="snippet-list-viewport"
      className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div
        data-testid="snippet-list"
        role="listbox"
        aria-label={i18n.t("dashboard.snippetListLabel")}
        aria-activedescendant={selectedId ? `snippet-${selectedId}` : ""}
        className="p-2 pb-14"
      >
        {showDraft && (
          <div className="h-14 w-full pb-2">
            <div className="flex h-12 w-full items-center rounded-lg border border-dashed bg-muted px-2.5 text-left">
              <div className="flex w-full min-w-0 items-center gap-2 overflow-hidden">
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                  {draft.label || i18n.t("dashboard.draftLabel")}
                </span>
                <span className="max-w-18 shrink-0 truncate rounded-sm border px-1.5 py-0 font-mono text-xs text-muted-foreground">
                  {draft.shortcut || i18n.t("dashboard.draftShortcut")}
                </span>
              </div>
            </div>
          </div>
        )}
        <div style={{ height: headerHeight + range.paddingTop }} />
        {rows.map((snippet) => (
          <div key={snippet.id} className="h-14">
            <SnippetListItem
              snippet={snippet}
              snippetId={`snippet-${snippet.id}`}
              isSelected={selectedId === snippet.id && !isCreating}
              onClick={() => onSelect(snippet.id)}
              className="h-12"
            />
          </div>
        ))}
        <div style={{ height: range.paddingBottom }} />
      </div>
    </div>
  );
}
