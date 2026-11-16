import { useEffect } from "react";
import { Images, LayoutList, LayoutGrid, Trash2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { InlineError } from "@/components/ui/inline-error";
import { MEDIA_LIMITS } from "@/config/constants";
import {
  cancelDelete,
  dismissLoadError,
  clearAltSaved,
  disposeObjectUrls,
  findImageItem,
  loadMediaLibrary,
  removeMedia,
  requestDelete,
  saveAlt,
  setAltDraft,
  setViewMode,
  totalMediaBytes,
  useMedia,
} from "@/store/media";
import { i18n } from "#i18n";

export function ImagesSection() {
  const items = useMedia((s) => s.items);
  const loading = useMedia((s) => s.loading);
  const loadError = useMedia((s) => s.loadError);
  const deleteErrors = useMedia((s) => s.deleteErrors);
  const confirmDeleteId = useMedia((s) => s.confirmDeleteId);
  const viewMode = useMedia((s) => s.viewMode);
  const altDraft = useMedia((s) => s.altDraft);
  const altSaved = useMedia((s) => s.altSaved);
  const altErrors = useMedia((s) => s.altErrors);

  const handleSaveAlt = async (id: string) => {
    const saved = await saveAlt(id);
    if (!saved) return;
    // The "Saved" flash, on a timer. Kept here rather than in the store because it
    // is a presentation concern with no state of its own beyond the flag, and a
    // store holding a timer would keep it alive past unmount.
    setTimeout(() => clearAltSaved(id), 2000);
  };

  // The load owns its object URLs now, and so does the teardown.
  //
  // `disposeObjectUrls` revokes every URL the store created rather than the ones
  // a `useRef` happened to be holding when the component went away. The ref could
  // not: a load that resolved after unmount created URLs nobody would ever revoke,
  // pinning the blobs in memory for the life of the document.
  useEffect(() => {
    void loadMediaLibrary();
    return () => disposeObjectUrls();
  }, []);

  const totalBytes = totalMediaBytes(items);

  const totalKB = (totalBytes / 1024).toFixed(1);
  const maxKB = (MEDIA_LIMITS.MAX_TOTAL_SIZE / 1024).toFixed(0);
  const totalPercent = Math.min(
    100,
    Math.round((totalBytes / MEDIA_LIMITS.MAX_TOTAL_SIZE) * 100)
  );

  const confirmItem = findImageItem(items, confirmDeleteId);

  return (
    <div className="space-y-4">
      {/*
        No heading here. The page already renders the section title from the
        registry, so this component's own <h2>Images</h2> put the same word on
        screen twice — once as the page heading, once directly beneath it.
      */}
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {i18n.t("options.images.description")}
        </p>
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
              <Icon icon={LayoutList} />
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
              <Icon icon={LayoutGrid} />
            </button>
          </div>
        )}
      </div>

      {!loading && items.length > 0 && (
        <div className="rounded-xl border p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Icon icon={Images} className="text-muted-foreground" />
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
            aria-label={i18n.t("options.images.totalStorage")}
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
          onDismiss={dismissLoadError}
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
          <Icon icon={Images} size="3xl" className="text-muted-foreground/40" />
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
                // Stable per-image handle, in both view modes. Without it the
                // only way to assert on one image is `textContent("body")`,
                // which cannot tell this image's state from another's — the
                // reason the e2e test for width-suffixed references could only
                // check that the page contained the substring "image" (which the
                // sidebar's own "Images" link satisfied).
                data-testid={`image-row-${item.meta.id}`}
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
                    <Icon
                      icon={Images}
                      size="2xl"
                      className="text-muted-foreground/40"
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
                        setAltDraft(item.meta.id, e.target.value)
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
                        <Icon
                          icon={Check}
                          stroke="emphasis"
                          className="text-green-500"
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
                  onClick={() => requestDelete(item.meta.id)}
                  aria-label={`${i18n.t("options.images.deleteButton")} ${item.meta.id}`}
                >
                  <Icon icon={Trash2} className="mr-1" />
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
                // Stable per-image handle. Without it the only way to assert on
                // one image row is `textContent("body")`, which cannot tell this
                // image's state from any other row's — the reason the e2e test
                // for width-suffixed references could only check that the page
                // contained the substring "image".
                data-testid={`image-row-${item.meta.id}`}
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
                    <Icon
                      icon={Images}
                      size="3xl"
                      className="text-muted-foreground/30"
                    />
                  )}

                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                    <button
                      onClick={() => requestDelete(item.meta.id)}
                      aria-label={`${i18n.t("options.images.deleteButton")} ${item.meta.id}`}
                      className="h-8 w-8 rounded-full bg-background/90 flex items-center justify-center text-destructive hover:bg-background transition-colors shadow-sm"
                    >
                      <Icon icon={Trash2} />
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
                        setAltDraft(item.meta.id, e.target.value)
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
                        <Icon
                          icon={Check}
                          stroke="emphasis"
                          className="text-green-500"
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
            if (e.key === "Escape") cancelDelete();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-confirm-title"
            className="bg-background rounded-xl border shadow-xl w-full max-w-sm p-6 space-y-4"
          >
            <div className="flex items-start gap-3">
              <div className="shrink-0 h-8 w-8 rounded-full bg-red-100 dark:bg-red-950/40 flex items-center justify-center">
                <Icon
                  icon={Trash2}
                  size="lg"
                  className="text-red-600 dark:text-red-400"
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
              <Button size="sm" variant="outline" onClick={cancelDelete}>
                {i18n.t("common.cancel")}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => void removeMedia(confirmItem.meta.id)}
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
