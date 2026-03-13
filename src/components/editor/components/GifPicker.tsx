import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useDeferredValue,
} from "react";
import { Search, X, RefreshCw } from "lucide-react";
import { cn } from "~/lib/utils";
import {
  useVirtualFloating,
  offset as floatingOffset,
  flip,
  shift,
} from "@platejs/floating";
import { search, trending, type GiphyGif, GiphyAuthError } from "~/lib/giphy";
import { captureError } from "~/lib/sentry";
import { i18n } from "#i18n";
import type { TRange } from "platejs";

const PAGE_SIZE = 20;

interface GifPickerProps {
  onSelectGif: (giphyId: string) => void;
  onClose: () => void;
  targetRange: TRange | null;
  manualTrigger?: boolean;
}

export function GifPicker({
  onSelectGif,
  onClose,
  targetRange,
  manualTrigger = false,
}: GifPickerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const [gifs, setGifs] = useState<GiphyGif[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageOffset, setPageOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  // Focus search on mount
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // Load GIFs when query changes (debounced via deferred value)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPageOffset(0);

    const loadGifs = async () => {
      try {
        const result = deferredQuery.trim()
          ? await search(deferredQuery.trim(), { limit: PAGE_SIZE, offset: 0 })
          : await trending({ limit: PAGE_SIZE, offset: 0 });

        if (!cancelled) {
          setGifs(result.gifs);
          setTotalCount(result.totalCount);
          setLoading(false);
        }
      } catch (err) {
        if (cancelled) return;
        captureError(err as Error, {
          action: "gifPicker.load",
          query: deferredQuery,
        });
        if (err instanceof GiphyAuthError) {
          setError(i18n.t("gifPicker.apiKeyMissing"));
        } else {
          setError(i18n.t("gifPicker.error"));
        }
        setLoading(false);
      }
    };

    // Small debounce for search queries
    const timer = deferredQuery.trim()
      ? setTimeout(loadGifs, 0)
      : (loadGifs(), undefined);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [deferredQuery]);

  const handleLoadMore = useCallback(async () => {
    const newOffset = pageOffset + PAGE_SIZE;
    setLoadingMore(true);
    try {
      const result = deferredQuery.trim()
        ? await search(deferredQuery.trim(), {
            limit: PAGE_SIZE,
            offset: newOffset,
          })
        : await trending({ limit: PAGE_SIZE, offset: newOffset });
      setGifs((prev) => [...prev, ...result.gifs]);
      setPageOffset(newOffset);
    } catch (err) {
      captureError(err as Error, { action: "gifPicker.loadMore" });
    } finally {
      setLoadingMore(false);
    }
  }, [deferredQuery, pageOffset]);

  const handleRetry = useCallback(() => {
    setError(null);
    setLoading(true);
    // re-trigger effect by toggling query
    setQuery((q) => q + "");
  }, []);

  // Floating positioning
  const getBoundingClientRect = useCallback(() => {
    if (manualTrigger || !targetRange) {
      try {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          if (rect.width > 0 || rect.height > 0) {
            return {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
              left: rect.left,
            };
          }
        }
      } catch {
        /* ignore */
      }
      return {
        x: 100,
        y: 150,
        width: 0,
        height: 20,
        top: 150,
        right: 100,
        bottom: 170,
        left: 100,
      };
    }
    try {
      const domRange = window.getSelection()?.getRangeAt(0);
      if (domRange) {
        const rect = domRange.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
        };
      }
    } catch {
      /* ignore */
    }
    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    };
  }, [targetRange, manualTrigger]);

  const floating = useVirtualFloating({
    getBoundingClientRect,
    open: true,
    strategy: "fixed",
    middleware: [
      floatingOffset(4),
      flip({ fallbackPlacements: ["top-start", "bottom-end", "top-end"] }),
      shift({ padding: 8 }),
    ],
    placement: "bottom-start",
  });

  // Click outside closes
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  // Keyboard: Escape closes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const hasMore = gifs.length < totalCount;

  return (
    <div
      ref={(node) => {
        panelRef.current = node;
        floating.refs.setFloating(node);
      }}
      style={floating.style}
      className="z-50 w-72 rounded-lg border border-border bg-popover shadow-lg flex flex-col max-h-[min(360px,80vh)]"
      role="dialog"
      aria-label="GIF picker"
    >
      {/* Search header */}
      <div className="flex items-center gap-2 p-2 border-b border-border">
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <input
          ref={searchInputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={i18n.t("gifPicker.searchPlaceholder")}
          className={cn(
            "flex-1 bg-transparent text-sm outline-none",
            "text-foreground placeholder:text-muted-foreground"
          )}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Section label */}
      {!query && (
        <div className="text-[10px] font-medium text-muted-foreground px-2 pt-1.5 uppercase tracking-wide">
          {i18n.t("gifPicker.trending")}
        </div>
      )}

      {/* GIF grid */}
      <div className="overflow-y-auto max-h-64 p-1.5">
        {loading ? (
          <div className="flex items-center justify-center h-24 text-xs text-muted-foreground">
            {i18n.t("gifPicker.loading")}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-24 gap-2 text-xs text-muted-foreground">
            <span className="text-center px-2">{error}</span>
            <button
              type="button"
              onClick={handleRetry}
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <RefreshCw className="h-3 w-3" />
              {i18n.t("gifPicker.retry")}
            </button>
          </div>
        ) : gifs.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-xs text-muted-foreground text-center px-2">
            {i18n.t("gifPicker.noResults", [deferredQuery])}
          </div>
        ) : (
          <>
            <div className="columns-2 gap-1 space-y-1">
              {gifs.map((gif) => (
                <button
                  key={gif.id}
                  type="button"
                  onClick={() => {
                    onSelectGif(gif.id);
                    onClose();
                  }}
                  className={cn(
                    "block w-full overflow-hidden rounded-sm border border-border break-inside-avoid",
                    "hover:ring-2 hover:ring-primary focus:ring-2 focus:ring-primary",
                    "transition-all duration-100"
                  )}
                  title={gif.title}
                  style={
                    gif.previewWidth && gif.previewHeight
                      ? {
                          aspectRatio: `${gif.previewWidth} / ${gif.previewHeight}`,
                        }
                      : undefined
                  }
                >
                  <img
                    src={gif.previewUrl}
                    alt={gif.title}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
            {hasMore && (
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className={cn(
                  "mt-1 w-full text-xs text-center py-1.5 text-muted-foreground",
                  "hover:text-foreground hover:bg-accent rounded transition-colors",
                  loadingMore && "opacity-50 cursor-not-allowed"
                )}
              >
                {loadingMore
                  ? i18n.t("gifPicker.loading")
                  : i18n.t("gifPicker.loadMore")}
              </button>
            )}
          </>
        )}
      </div>

      {/* Footer: Powered by GIPHY */}
      <div className="border-t border-border px-2 py-1.5 text-[10px] text-muted-foreground text-right">
        {i18n.t("gifPicker.poweredBy")}
      </div>
    </div>
  );
}
