/**
 * Drag-to-resize handle for the options sidebar.
 *
 * Pointer capture on the handle keeps the drag alive when the pointer leaves
 * the 6px hit area, which is what makes a hairline divider usable as a grip.
 * The width is persisted so it survives a page reload.
 *
 * spec: specs/options-redesign.spec.md
 */

import { useCallback, useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/** Below this the nav labels truncate to nothing; above it the content pane is squeezed. */
export const SIDEBAR_MIN_PX = 176;
export const SIDEBAR_MAX_PX = 420;
export const SIDEBAR_DEFAULT_PX = 256;

/**
 * Where the width is persisted. Exported so the writer in `OptionsPage` uses
 * the same key rather than re-declaring a string literal.
 */
export const SIDEBAR_WIDTH_KEY = "optionsSidebarWidth";

/**
 * Read a persisted width, clamped to the allowed range.
 *
 * Exported and null-safe so the options page can apply the same width on its
 * first paint; reading it twice would make the rail jump after hydration.
 */
export function readSidebarWidth(): number {
  try {
    const raw = globalThis.localStorage?.getItem(SIDEBAR_WIDTH_KEY);
    const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return SIDEBAR_DEFAULT_PX;
    return clampSidebarWidth(parsed);
  } catch {
    // Storage can throw in a restricted context; the default is fine.
    return SIDEBAR_DEFAULT_PX;
  }
}

export function clampSidebarWidth(px: number): number {
  return Math.min(SIDEBAR_MAX_PX, Math.max(SIDEBAR_MIN_PX, Math.round(px)));
}

export function SidebarResizer({
  width,
  onWidthChange,
  ariaLabel,
}: {
  width: number;
  onWidthChange: (next: number) => void;
  ariaLabel: string;
}) {
  const draggingRef = useRef(false);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      draggingRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.style.cursor = "col-resize";
      // Stop the browser from selecting the sidebar labels mid-drag.
      document.body.style.userSelect = "none";
    },
    []
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      onWidthChange(clampSidebarWidth(event.clientX));
    },
    [onWidthChange]
  );

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  // Arrow keys resize too, so the width is adjustable without a pointer. The
  // handle is a slider so assistive tech announces the current width.
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 48 : 16;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onWidthChange(clampSidebarWidth(width - step));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        onWidthChange(clampSidebarWidth(width + step));
      } else if (event.key === "Home") {
        event.preventDefault();
        onWidthChange(SIDEBAR_MIN_PX);
      } else if (event.key === "End") {
        event.preventDefault();
        onWidthChange(SIDEBAR_MAX_PX);
      }
    },
    [onWidthChange, width]
  );

  // A drag that ends outside the window never fires pointerup on the handle.
  useEffect(() => {
    const stop = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("blur", stop);
    return () => window.removeEventListener("blur", stop);
  }, []);

  return (
    // `-right-1`, not `-left-1`: the handle straddles the divider at the rail's
    // RIGHT edge. Sitting it at the left edge put the grip at x≈0, so a drag
    // anywhere along it clamped the rail to its minimum.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_MIN_PX}
      aria-valuemax={SIDEBAR_MAX_PX}
      tabIndex={0}
      data-testid="sidebar-resizer"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
      onDoubleClick={() => onWidthChange(SIDEBAR_DEFAULT_PX)}
      className={cn(
        "group absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none",
        "focus-visible:outline-none"
      )}
    >
      {/* The visible line widens on hover/focus so the grip is discoverable. */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors",
          "group-hover:bg-primary group-focus-visible:bg-primary"
        )}
      />
    </div>
  );
}