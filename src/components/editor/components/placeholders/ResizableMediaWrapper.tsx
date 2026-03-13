/**
 * ResizableMediaWrapper
 *
 * A shared wrapper used by ImagePlaceholderElement and GifPlaceholderElement
 * to provide:
 *   - Drag-to-resize via a right-edge handle (updates the node's `width` prop)
 *   - A hover-visible delete (×) button that removes the node from the editor
 *
 * The component is contentEditable={false} and must be rendered inside a
 * Plate void inline element.
 */

import { useCallback, useRef, useState } from "react";
import { X, GripVertical } from "lucide-react";
import { cn } from "~/lib/utils";
import { useEditorRef } from "platejs/react";
import type { TElement } from "platejs";
import { i18n } from "#i18n";

interface ResizableMediaWrapperProps {
  /** The Plate element node (used to locate it in the tree for setNodes / removeNodes). */
  element: TElement;
  /** Current pixel width, or undefined for auto. */
  width?: number;
  /** Called when the user finishes dragging with the new pixel width. */
  onWidthChange: (newWidth: number) => void;
  children: React.ReactNode;
  className?: string;
}

const MIN_WIDTH = 40;

/**
 * Walk up the DOM from `el` to find the nearest scrollable ancestor
 * (overflow-auto / overflow-scroll).  This is the PlateContent container
 * whose clientWidth is the true maximum we must not exceed.
 */
function getScrollParentWidth(el: HTMLElement): number {
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.body) {
    const { overflow, overflowX } = getComputedStyle(node);
    if (/auto|scroll/.test(overflow) || /auto|scroll/.test(overflowX)) {
      return node.clientWidth;
    }
    node = node.parentElement;
  }
  // Fallback: use the direct parent's offsetWidth
  return el.parentElement?.offsetWidth ?? 600;
}

export function ResizableMediaWrapper({
  element,
  width,
  onWidthChange,
  children,
  className,
}: ResizableMediaWrapperProps) {
  const editor = useEditorRef();
  const containerRef = useRef<HTMLSpanElement>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // ── Delete ────────────────────────────────────────────────────────────────

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Remove this node from the editor tree
      const path = editor.api.findPath(element);
      if (path) {
        editor.tf.removeNodes({ at: path });
      }
      editor.tf.focus();
    },
    [editor, element]
  );

  // ── Resize ────────────────────────────────────────────────────────────────

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startWidth =
        width ?? containerRef.current?.offsetWidth ?? MIN_WIDTH;

      // Capture the available width at drag-start so we never overflow the
      // editor's scroll container (i.e. the visible popup area).
      const maxWidth = containerRef.current
        ? getScrollParentWidth(containerRef.current)
        : 600;

      setIsResizing(true);

      const onMouseMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startX;
        const newWidth = Math.min(
          maxWidth,
          Math.max(MIN_WIDTH, startWidth + delta)
        );
        // Live-update the container style for smooth feedback (no re-render)
        if (containerRef.current) {
          containerRef.current.style.width = `${newWidth}px`;
        }
      };

      const onMouseUp = (upEvent: MouseEvent) => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        setIsResizing(false);

        const delta = upEvent.clientX - startX;
        const finalWidth = Math.min(
          maxWidth,
          Math.max(MIN_WIDTH, startWidth + delta)
        );
        onWidthChange(Math.round(finalWidth));
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [width, onWidthChange]
  );

  return (
    <span
      ref={containerRef}
      contentEditable={false}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={width ? { width: `${width}px` } : undefined}
      className={cn(
        "relative inline-block align-baseline mx-0.5 select-none",
        isResizing && "cursor-col-resize",
        className
      )}
    >
      {/* Media content (image or GIF) */}
      {children}

      {/* Delete button — visible on hover */}
      <button
        type="button"
        contentEditable={false}
        onMouseDown={handleDelete}
        title={i18n.t("mediaControls.delete")}
        className={cn(
          "absolute top-0.5 right-0.5 z-10",
          "flex items-center justify-center",
          "w-5 h-5 rounded-full",
          "bg-black/60 text-white",
          "transition-opacity duration-150",
          "hover:bg-destructive",
          isHovered || isResizing ? "opacity-100" : "opacity-0"
        )}
      >
        <X className="w-3 h-3" strokeWidth={2.5} />
      </button>

      {/* Resize handle — right edge, visible on hover */}
      <span
        contentEditable={false}
        onMouseDown={handleResizeMouseDown}
        title={i18n.t("mediaControls.resize")}
        className={cn(
          "absolute top-0 right-0 bottom-0 z-10",
          "w-3 flex items-center justify-center",
          "cursor-col-resize",
          "transition-opacity duration-150",
          isHovered || isResizing ? "opacity-100" : "opacity-0"
        )}
      >
        <GripVertical
          className={cn(
            "w-3 h-8 text-white drop-shadow",
            "[filter:drop-shadow(0_0_2px_rgba(0,0,0,0.8))]"
          )}
          strokeWidth={2}
        />
      </span>
    </span>
  );
}
