import { useState, useRef, useEffect, useCallback } from "react";
import { Images, LayoutList, LayoutGrid, Trash2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { InlineError } from "@/components/ui/inline-error";
import { SYNC_QUOTA, MEDIA_LIMITS } from "@/config/constants";
import {
  listMedia,
  getMedia,
  deleteMedia,
  updateMediaAlt,
  type MediaMetadata,
} from "@/storage/backends/media";
import { getSnippets } from "@/storage";
import { i18n } from "#i18n";
import { captureError } from "@/lib/sentry";

interface ImageItem {
  meta: MediaMetadata;
  objectUrl: string | null;
  referencingSnippets: string[];
}

type ImageViewMode = "list" | "grid";

export function ImagesSection() {
  const [items, setItems] = useState<ImageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ImageViewMode>("list");
  const objectUrlsRef = useRef<string[]>([]);

  const [altDraft, setAltDraft] = useState<Record<string, string>>({});
  const [altSaved, setAltSaved] = useState<Record<string, boolean>>({});
  const [altErrors, setAltErrors] = useState<Record<string, string>>({});

  const handleSaveAlt = useCallback(
    async (id: string) => {
      const draft = altDraft[id] ?? "";
      try {
        await updateMediaAlt(id, draft);
        setItems((prev) =>
          prev.map((item) =>
            item.meta.id === id
              ? {
                  ...item,
                  meta: { ...item.meta, alt: draft.trim() || undefined },
                }
              : item
          )
        );
        setAltErrors((prev) => ({ ...prev, [id]: "" }));
        setAltSaved((prev) => ({ ...prev, [id]: true }));
        setTimeout(
          () => setAltSaved((prev) => ({ ...prev, [id]: false })),
          2000
        );
      } catch {
        setAltErrors((prev) => ({
          ...prev,
          [id]: i18n.t("options.images.errors.failedToSaveDescription"),
        }));
      }
    },
    [altDraft]
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [mediaList, snippets] = await Promise.all([
          listMedia(),
          getSnippets(),
        ]);

        if (cancelled) return;

        const refMap: Record<string, string[]> = {};
        for (const snippet of snippets) {
          const matches = snippet.content.matchAll(
            /\{\{image:([a-f0-9-]+)(?::\d+)?\}\}/g
          );
          for (const match of matches) {
            const id = match[1];
            if (!refMap[id]) refMap[id] = [];
            if (!refMap[id].includes(snippet.label)) {
              refMap[id].push(snippet.label);
            }
          }
        }

        const resolved: ImageItem[] = await Promise.all(
          mediaList.map(async (meta) => {
            try {
              const entry = await getMedia(meta.id);
              if (entry?.blob) {
                const url = URL.createObjectURL(entry.blob);
                objectUrlsRef.current.push(url);
                return {
                  meta,
                  objectUrl: url,
                  referencingSnippets: refMap[meta.id] ?? [],
                };
              }
            } catch {}
            return {
              meta,
              objectUrl: null,
              referencingSnippets: refMap[meta.id] ?? [],
            };
          })
        );

        if (!cancelled) {
          setItems(resolved);
          setAltDraft(
            Object.fromEntries(
              resolved.map((item) => [item.meta.id, item.meta.alt ?? ""])
            )
          );
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          captureError(err, { action: "imagesSection.load" });
          setLoadError(i18n.t("options.images.errors.failedToLoad"));
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
      for (const url of objectUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      objectUrlsRef.current = [];
    };
  }, []);

  const handleDelete = async (id: string) => {
    try {
      await deleteMedia(id);
      const item = items.find((i) => i.meta.id === id);
      if (item?.objectUrl) {
        URL.revokeObjectURL(item.objectUrl);
        objectUrlsRef.current = objectUrlsRef.current.filter(
          (u) => u !== item.objectUrl
        );
      }
      setItems((prev) => prev.filter((i) => i.meta.id !== id));
      setConfirmDeleteId(null);
    } catch (err) {
      captureError(err, { action: "imagesSection.delete", imageId: id });
      setDeleteErrors((prev) => ({
        ...prev,
        [id]: i18n.t("options.images.errors.failedToDelete"),
      }));
      setConfirmDeleteId(null);
    }
  };

  const totalBytes = items.reduce((sum, item) => sum + item.meta.size, 0);
  const totalKB = (totalBytes / 1024).toFixed(1);
  const maxKB = (MEDIA_LIMITS.MAX_TOTAL_SIZE / 1024).toFixed(0);
  const totalPercent = Math.min(
    100,
    Math.round((totalBytes / MEDIA_LIMITS.MAX_TOTAL_SIZE) * 100)
  );

  const confirmItem = confirmDeleteId
    ? items.find((i) => i.meta.id === confirmDeleteId)
    : null;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-1">
            {i18n.t("options.images.title")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {i18n.t("options.images.description")}
          </p>
        </div>
        {!loading && items.length > 0 && (
          <div className="flex shrink-0 items-center gap-0.5 rounded-lg border bg-muted/50 p-0.5">
            <button
              onClick={() => setViewMode("list")}
              aria-label={i18n.t("options.images.viewList")}
              title={i18n.t("options.images.viewList")}
              className={cn(
                "flex items-center justify-center h-7 w-7 rounded-md transition-all",
                viewMode === "list"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <LayoutList className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
            <button
              onClick={() => setViewMode("grid")}
              aria-label={i18n.t("options.images.viewGrid")}
              title={i18n.t("options.images.viewGrid")}
              className={cn(
                "flex items-center justify-center h-7 w-7 rounded-md transition-all",
                viewMode === "grid"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          </div>
        )}
      </div>

      {!loading && items.length > 0 && (
        <div className="rounded-xl border p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Images
                className="h-3.5 w-3.5 text-muted-foreground"
                strokeWidth={1.5}
              />
              <span className="text-xs text-muted-foreground">
                {i18n.t("options.images.totalStorage")}
              </span>
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {totalKB} / {maxKB} KB
            </span>
          </div>
          <Progress
            value={totalPercent}
            className={cn(
              totalPercent >= 80
                ? "[&>div]:bg-amber-500"
                : "[&>div]:bg-indigo-500 dark:[&>div]:bg-indigo-400"
            )}
          />
        </div>
      )}

      {loadError && (
        <InlineError
          message={loadError}
          onDismiss={() => setLoadError(null)}
          className="rounded-lg border border-red-200 dark:border-red-800"
        />
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-foreground" />
          {i18n.t("options.images.loading")}
        </div>
      )}

      {!loading && !loadError && items.length === 0 && (
        <div className="rounded-xl border border-dashed p-10 flex flex-col items-center justify-center gap-3 text-center">
          <Images
            className="h-8 w-8 text-muted-foreground/40"
            strokeWidth={1}
          />
          <p className="text-sm text-muted-foreground max-w-xs">
            {i18n.t("options.images.empty")}
          </p>
        </div>
      )}

      {!loading && items.length > 0 && viewMode === "list" && (
        <div className="space-y-3">
          {items.map((item) => {
            const sizeKB = (item.meta.size / 1024).toFixed(1);
            const ext = item.meta.mimeType.split("/")[1]?.toUpperCase() ?? "";

            return (
              <div
                key={item.meta.id}
                className="rounded-xl border p-4 flex items-start gap-4"
              >
                <div className="shrink-0 h-16 w-16 rounded-lg border bg-muted/50 overflow-hidden flex items-center justify-center">
                  {item.objectUrl ? (
                    <img
                      src={item.objectUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Images
                      className="h-6 w-6 text-muted-foreground/40"
                      strokeWidth={1}
                    />
                  )}
                </div>

                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-xs font-mono text-muted-foreground truncate">
                    {item.meta.id}
                  </p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span>{ext}</span>
                    {item.meta.width > 0 && item.meta.height > 0 && (
                      <span>
                        {i18n.t("options.images.dimensions", [
                          item.meta.width,
                          item.meta.height,
                        ])}
                      </span>
                    )}
                    <span>{sizeKB} KB</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {item.referencingSnippets.length > 0 ? (
                      i18n.t("options.images.referencedBy", [
                        item.referencingSnippets.join(", "),
                      ])
                    ) : (
                      <span className="italic">
                        {i18n.t("options.images.noReferences")}
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <Input
                      type="text"
                      value={altDraft[item.meta.id] ?? ""}
                      onChange={(e) =>
                        setAltDraft((prev) => ({
                          ...prev,
                          [item.meta.id]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveAlt(item.meta.id);
                      }}
                      placeholder={i18n.t("options.images.altText.placeholder")}
                      aria-label={i18n.t("options.images.altText.label")}
                      className="h-7 text-[11px] flex-1"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="shrink-0 h-7 text-[11px] px-2"
                      onClick={() => handleSaveAlt(item.meta.id)}
                    >
                      {altSaved[item.meta.id] ? (
                        <Check
                          className="h-3 w-3 text-green-500"
                          strokeWidth={2.5}
                        />
                      ) : (
                        i18n.t("common.save")
                      )}
                    </Button>
                  </div>
                  {altErrors[item.meta.id] && (
                    <p className="text-[11px] text-red-600 dark:text-red-400">
                      {altErrors[item.meta.id]}
                    </p>
                  )}
                  {deleteErrors[item.meta.id] && (
                    <p className="text-[11px] text-red-600 dark:text-red-400">
                      {deleteErrors[item.meta.id]}
                    </p>
                  )}
                </div>

                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0 h-8 text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => setConfirmDeleteId(item.meta.id)}
                  aria-label={`${i18n.t("options.images.deleteButton")} ${item.meta.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" strokeWidth={1.5} />
                  {i18n.t("options.images.deleteButton")}
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {!loading && items.length > 0 && viewMode === "grid" && (
        <div className="grid grid-cols-3 gap-3">
          {items.map((item) => {
            const sizeKB = (item.meta.size / 1024).toFixed(1);
            const ext = item.meta.mimeType.split("/")[1]?.toUpperCase() ?? "";

            return (
              <div
                key={item.meta.id}
                className="group relative rounded-xl border bg-muted/20 overflow-hidden flex flex-col"
              >
                <div className="relative aspect-square bg-muted/50 flex items-center justify-center overflow-hidden">
                  {item.objectUrl ? (
                    <img
                      src={item.objectUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Images
                      className="h-8 w-8 text-muted-foreground/30"
                      strokeWidth={1}
                    />
                  )}

                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                    <button
                      onClick={() => setConfirmDeleteId(item.meta.id)}
                      aria-label={`${i18n.t("options.images.deleteButton")} ${item.meta.id}`}
                      className="h-8 w-8 rounded-full bg-background/90 flex items-center justify-center text-destructive hover:bg-background transition-colors shadow-sm"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                  </div>
                </div>

                <div className="px-2.5 py-2 space-y-0.5">
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="font-medium">{ext}</span>
                    <span>·</span>
                    <span>{sizeKB} KB</span>
                    {item.meta.width > 0 && item.meta.height > 0 && (
                      <>
                        <span>·</span>
                        <span>
                          {item.meta.width}×{item.meta.height}
                        </span>
                      </>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {item.referencingSnippets.length > 0 ? (
                      i18n.t("options.images.referencedBy", [
                        item.referencingSnippets.join(", "),
                      ])
                    ) : (
                      <span className="italic">
                        {i18n.t("options.images.noReferences")}
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-1 pt-0.5">
                    <Input
                      type="text"
                      value={altDraft[item.meta.id] ?? ""}
                      onChange={(e) =>
                        setAltDraft((prev) => ({
                          ...prev,
                          [item.meta.id]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveAlt(item.meta.id);
                      }}
                      placeholder={i18n.t("options.images.altText.placeholder")}
                      aria-label={i18n.t("options.images.altText.label")}
                      className="h-6 text-[10px] flex-1 px-1.5"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="shrink-0 h-6 text-[10px] px-1.5"
                      onClick={() => handleSaveAlt(item.meta.id)}
                    >
                      {altSaved[item.meta.id] ? (
                        <Check
                          className="h-2.5 w-2.5 text-green-500"
                          strokeWidth={2.5}
                        />
                      ) : (
                        i18n.t("common.save")
                      )}
                    </Button>
                  </div>
                  {altErrors[item.meta.id] && (
                    <p className="text-[10px] text-red-600 dark:text-red-400">
                      {altErrors[item.meta.id]}
                    </p>
                  )}
                  {deleteErrors[item.meta.id] && (
                    <p className="text-[10px] text-red-600 dark:text-red-400">
                      {deleteErrors[item.meta.id]}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {confirmItem && (
        <div
          className="fixed inset-0 z-50 bg-black/40 dark:bg-black/60 flex items-center justify-center p-4"
          onKeyDown={(e) => {
            if (e.key === "Escape") setConfirmDeleteId(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-confirm-title"
            className="bg-background rounded-2xl border shadow-xl w-full max-w-sm p-6 space-y-4"
          >
            <div className="flex items-start gap-3">
              <div className="shrink-0 h-8 w-8 rounded-full bg-red-100 dark:bg-red-950/40 flex items-center justify-center">
                <Trash2
                  className="h-4 w-4 text-red-600 dark:text-red-400"
                  strokeWidth={1.5}
                />
              </div>
              <div className="space-y-1">
                <h3
                  id="delete-confirm-title"
                  className="text-sm font-semibold text-foreground"
                >
                  {i18n.t("options.images.deleteConfirmTitle")}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {confirmItem.referencingSnippets.length > 0
                    ? i18n.t("options.images.deleteConfirmMessage", [
                        confirmItem.referencingSnippets.length,
                      ])
                    : i18n.t("options.images.deleteConfirmMessageNoRefs")}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmDeleteId(null)}
              >
                {i18n.t("common.cancel")}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => handleDelete(confirmItem.meta.id)}
              >
                {i18n.t("options.images.deleteButton")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
