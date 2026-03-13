import { useCallback, useEffect, useRef, useState } from "react";
import { ImageIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { useEditorRef } from "platejs/react";
import type { TElement } from "platejs";
import { getMediaBlob } from "~/storage/backends/media";
import { captureError } from "~/lib/sentry";
import { i18n } from "#i18n";
import { ResizableMediaWrapper } from "./ResizableMediaWrapper";

interface ImagePlaceholderElementProps {
  children: React.ReactNode;
  attributes: Record<string, unknown>;
  element: TElement & { mediaId?: string; width?: number };
}

export function ImagePlaceholderElement({
  children,
  attributes,
  element,
}: ImagePlaceholderElementProps) {
  const editor = useEditorRef();
  const mediaId = element.mediaId ?? "";

  // Keep a ref to the latest element so handleWidthChange never closes over a
  // stale Slate node reference after Plate re-renders during the drag.
  const elementRef = useRef(element);
  useEffect(() => {
    elementRef.current = element;
  });

  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!mediaId) {
      setLoading(false);
      setError(true);
      return;
    }

    let revoked = false;
    let url: string | null = null;

    getMediaBlob(mediaId)
      .then((blob) => {
        if (revoked) return;
        if (!blob) {
          setError(true);
          setLoading(false);
          return;
        }
        url = URL.createObjectURL(blob);
        setObjectUrl(url);
        setLoading(false);
      })
      .catch((err) => {
        if (revoked) return;
        captureError(err as Error, { mediaId });
        setError(true);
        setLoading(false);
      });

    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [mediaId]);

  const handleWidthChange = useCallback(
    (newWidth: number) => {
      const path = editor.api.findPath(elementRef.current);
      if (path) {
        editor.tf.setNodes({ width: newWidth } as Partial<TElement>, {
          at: path,
        });
      }
    },
    [editor]
  );

  if (loading) {
    return (
      <span
        {...attributes}
        contentEditable={false}
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded align-baseline mx-0.5",
          "bg-muted border border-border animate-pulse",
          "text-[11px] font-mono text-muted-foreground"
        )}
      >
        <ImageIcon className="h-2.5 w-2.5" strokeWidth={2.5} />
        <span>{i18n.t("imagePlaceholder.loading")}</span>
        <span className="hidden">{children}</span>
      </span>
    );
  }

  if (error || !objectUrl) {
    return (
      <span
        {...attributes}
        contentEditable={false}
        onClick={() => editor.tf.focus()}
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded cursor-pointer select-none align-baseline mx-0.5",
          "font-mono text-[11px] leading-none",
          "bg-destructive/10 border border-destructive/30 text-destructive",
          "hover:bg-destructive/20 transition-colors duration-150"
        )}
        title={i18n.t("imagePlaceholder.error")}
      >
        <ImageIcon className="h-2.5 w-2.5" strokeWidth={2.5} />
        <span>{i18n.t("imagePlaceholder.error")}</span>
        <span className="hidden">{children}</span>
      </span>
    );
  }

  return (
    <span {...attributes}>
      <ResizableMediaWrapper
        element={element}
        width={element.width}
        onWidthChange={handleWidthChange}
      >
        <img
          src={objectUrl}
          alt="image"
          title={i18n.t("imagePlaceholder.tooltip", [mediaId])}
          className={cn(
            "block w-full h-auto rounded border border-border",
            !element.width && "max-h-48 object-contain"
          )}
          draggable={false}
        />
        <span className="hidden">{children}</span>
      </ResizableMediaWrapper>
    </span>
  );
}
