import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useDeferredValue,
} from "react";
import { Search, X, Upload } from "lucide-react";
import { cn } from "~/lib/utils";
import {
  useVirtualFloating,
  offset as floatingOffset,
  flip,
  shift,
} from "@platejs/floating";
import {
  listMedia,
  getMediaBlob,
  type MediaMetadata,
} from "~/storage/backends/media";
import { captureError } from "~/lib/sentry";
import { i18n } from "#i18n";
import type { TRange } from "platejs";

interface ImagePickerProps {
  onSelectImage: (mediaId: string) => void;
  onUploadNew: (file?: File) => void;
  onClose: () => void;
  targetRange: TRange | null;
  manualTrigger?: boolean;
}

/** A single thumbnail rendered from a stored media entry. */
function MediaThumb({
  entry,
  onSelect,
}: {
  entry: MediaMetadata;
  onSelect: () => void;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let revoked = false;
    let url: string | null = null;

    getMediaBlob(entry.id)
      .then((blob) => {
        if (revoked || !blob) return;
        url = URL.createObjectURL(blob);
        setObjectUrl(url);
      })
      .catch((err) => {
        captureError(err as Error, { mediaId: entry.id });
      });

    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [entry.id]);

  if (!objectUrl) {
    return (
      <div className="block w-full aspect-square rounded-sm border border-border bg-muted animate-pulse break-inside-avoid" />
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "block w-full overflow-hidden rounded-sm border border-border break-inside-avoid",
        "hover:ring-2 hover:ring-primary focus:ring-2 focus:ring-primary",
        "transition-all duration-100"
      )}
      title={entry.alt ?? entry.id}
    >
      <img
        src={objectUrl}
        alt={entry.alt ?? ""}
        className="w-full h-auto object-cover"
        loading="lazy"
      />
    </button>
  );
}

export function ImagePicker({
  onSelectImage,
  onUploadNew,
  onClose,
  targetRange,
  manualTrigger = false,
}: ImagePickerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [isDragging, setIsDragging] = useState(false);

  const [allImages, setAllImages] = useState<MediaMetadata[]>([]);
  const [loading, setLoading] = useState(true);

  // Load all stored images on mount
  useEffect(() => {
    let cancelled = false;
    listMedia()
      .then((entries) => {
        if (cancelled) return;
        setAllImages(entries);
        setLoading(false);
      })
      .catch((err) => {
        captureError(err as Error, { action: "imagePicker.load" });
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Focus search on mount
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // Filter by alt text (client-side)
  const filtered = deferredQuery.trim()
    ? allImages.filter((img) =>
        (img.alt ?? "")
          .toLowerCase()
          .includes(deferredQuery.trim().toLowerCase())
      )
    : allImages;

  // Floating positioning — mirrors GifPicker
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

  // Escape closes
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

  // Drag-and-drop handlers on the panel
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if leaving the panel itself (not a child)
    if (!panelRef.current?.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) {
        onUploadNew(file);
      }
    },
    [onUploadNew]
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        onUploadNew(file);
      }
      e.target.value = "";
    },
    [onUploadNew]
  );

  return (
    <div
      ref={(node) => {
        panelRef.current = node;
        floating.refs.setFloating(node);
      }}
      style={floating.style}
      className={cn(
        "z-50 w-72 rounded-lg border border-border bg-popover shadow-lg flex flex-col max-h-[min(360px,80vh)]",
        isDragging && "ring-2 ring-primary"
      )}
      role="dialog"
      aria-label={i18n.t("imagePicker.ariaLabel")}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* Search header */}
      <div className="flex items-center gap-2 p-2 border-b border-border">
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <input
          ref={searchInputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={i18n.t("imagePicker.searchPlaceholder")}
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

      {/* Grid */}
      <div className="overflow-y-auto max-h-64 p-1.5">
        {isDragging ? (
          <div className="flex items-center justify-center h-24 text-xs text-primary font-medium">
            {i18n.t("imagePicker.dragging")}
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-24 text-xs text-muted-foreground">
            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 && allImages.length === 0 ? (
          /* No images at all */
          <div className="columns-2 gap-1 space-y-1">
            {/* Upload cell */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "flex flex-col items-center justify-center gap-1 w-full",
                "border-2 border-dashed border-border rounded-sm p-4",
                "text-muted-foreground hover:text-foreground hover:border-primary",
                "transition-colors duration-100 break-inside-avoid"
              )}
              title={i18n.t("imagePicker.uploadNew")}
            >
              <Upload className="h-4 w-4" />
              <span className="text-[10px] text-center leading-tight">
                {i18n.t("imagePicker.uploadNew")}
              </span>
            </button>
            <div className="col-span-2 pt-2 text-center text-xs text-muted-foreground px-2">
              {i18n.t("imagePicker.empty")}
            </div>
          </div>
        ) : filtered.length === 0 ? (
          /* Search returned no results */
          <div className="columns-2 gap-1 space-y-1">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "flex flex-col items-center justify-center gap-1 w-full",
                "border-2 border-dashed border-border rounded-sm p-4",
                "text-muted-foreground hover:text-foreground hover:border-primary",
                "transition-colors duration-100 break-inside-avoid"
              )}
              title={i18n.t("imagePicker.uploadNew")}
            >
              <Upload className="h-4 w-4" />
              <span className="text-[10px] text-center leading-tight">
                {i18n.t("imagePicker.uploadNew")}
              </span>
            </button>
            <div className="flex items-center justify-center text-xs text-muted-foreground text-center px-2 py-3">
              {i18n.t("imagePicker.noResults", [deferredQuery])}
            </div>
          </div>
        ) : (
          /* Normal grid: upload cell first, then thumbnails */
          <div className="columns-2 gap-1 space-y-1">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "flex flex-col items-center justify-center gap-1 w-full",
                "border-2 border-dashed border-border rounded-sm p-4",
                "text-muted-foreground hover:text-foreground hover:border-primary",
                "transition-colors duration-100 break-inside-avoid"
              )}
              title={i18n.t("imagePicker.uploadNew")}
            >
              <Upload className="h-4 w-4" />
              <span className="text-[10px] text-center leading-tight">
                {i18n.t("imagePicker.uploadNew")}
              </span>
            </button>
            {filtered.map((entry) => (
              <MediaThumb
                key={entry.id}
                entry={entry}
                onSelect={() => {
                  onSelectImage(entry.id);
                  onClose();
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
