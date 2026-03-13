import { useCallback, useState } from "react";
import { Film } from "lucide-react";
import { cn } from "~/lib/utils";
import { useEditorRef } from "platejs/react";
import type { TElement } from "platejs";
import { buildGifUrl } from "~/lib/giphy";
import { i18n } from "#i18n";
import { ResizableMediaWrapper } from "./ResizableMediaWrapper";

interface GifPlaceholderElementProps {
  children: React.ReactNode;
  attributes: Record<string, unknown>;
  element: TElement & { giphyId?: string; width?: number };
}

export function GifPlaceholderElement({
  children,
  attributes,
  element,
}: GifPlaceholderElementProps) {
  const editor = useEditorRef();
  const giphyId = element.giphyId ?? "";

  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const handleRetry = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setError(false);
    setRetryKey((k) => k + 1);
  }, []);

  const handleWidthChange = useCallback(
    (newWidth: number) => {
      const path = editor.api.findPath(element);
      if (path) {
        editor.tf.setNodes({ width: newWidth } as Partial<TElement>, {
          at: path,
        });
      }
    },
    [editor, element]
  );

  if (error) {
    return (
      <span
        {...attributes}
        contentEditable={false}
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded select-none align-baseline mx-0.5",
          "font-mono text-[11px] leading-none",
          "bg-destructive/10 border border-destructive/30 text-destructive"
        )}
      >
        <Film className="h-2.5 w-2.5" strokeWidth={2.5} />
        <span>{i18n.t("gifPlaceholder.error")}</span>
        <button
          type="button"
          onClick={handleRetry}
          className="underline hover:no-underline ml-1 text-[10px]"
        >
          {i18n.t("gifPlaceholder.retry")}
        </button>
        <span className="hidden">{children}</span>
      </span>
    );
  }

  const gifUrl = buildGifUrl(giphyId);

  return (
    <span {...attributes}>
      <ResizableMediaWrapper
        element={element}
        width={element.width}
        onWidthChange={handleWidthChange}
      >
        {/* GIF image */}
        <span className="block relative">
          <img
            key={retryKey}
            src={gifUrl}
            alt="GIF"
            className={cn(
              "block w-full h-auto rounded border border-border",
              !element.width && "max-h-48 object-contain"
            )}
            draggable={false}
            onError={() => setError(true)}
          />
          {/* "Powered by GIPHY" badge */}
          <span
            className={cn(
              "absolute bottom-0.5 right-0.5",
              "text-[9px] font-bold text-white",
              "bg-black/50 px-1 py-0.5 rounded",
              "pointer-events-none select-none"
            )}
          >
            {i18n.t("gifPlaceholder.poweredBy")}
          </span>
        </span>
        <span className="hidden">{children}</span>
      </ResizableMediaWrapper>
    </span>
  );
}
