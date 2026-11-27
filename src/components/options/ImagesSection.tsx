import { Fragment, useEffect } from "react";
import { Images, LayoutList, LayoutGrid, Trash2, Check } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { InlineError } from "@/components/ui/inline-error";
import { MEDIA_LIMITS } from "@/config/constants";
import { formatBytes } from "@/components/options/settings/panels/StoragePanel";
import { MESSAGE, sendMessage } from "@/lib/protocol";
import { captureError } from "@/lib/sentry";
import {
  cancelDelete,
  flushPendingAltSaves,
  dismissLoadError,
  disposeObjectUrls,
  findImageItem,
  loadMediaLibrary,
  removeMedia,
  requestDelete,
  scheduleAltSave,
  setAltDraft,
  setViewMode,
  totalMediaBytes,
  useMedia,
  type SnippetReference,
} from "@/store/media";
import { i18n } from "#i18n";

/**
 * Follow a "Used in" link into the popup.
 *
 * The options page cannot open its own popup, so the request goes through the
 * background: it owns both the route handoff and the tab fallback for browsers
 * that refuse `openPopup()`. The href is the same destination for a middle-click
 * or a copy-link, not a second implementation of the navigation.
 */
function openSnippetInPopup(snippetId: string): void {
  void sendMessage(MESSAGE.POPUP_SNIPPET, { snippetId }).catch(
    (err: unknown) => {
      captureError(err, { action: "images.openSnippet", snippetId });
    }
  );
}

function ReferencedBy({
  references,
}: {
  references: readonly SnippetReference[];
}) {
  if (references.length === 0) {
    return (
      <span className="italic">{i18n.t("options.images.noReferences")}</span>
    );
  }

  return (
    <>
      {i18n.t("options.images.referencedBy")}{" "}
      {references.map((reference, index) => (
        <Fragment key={reference.id}>
          {index > 0 && ", "}
          <a
            href={`/popup.html#/snippet/${encodeURIComponent(reference.id)}`}
            className="underline decoration-muted-foreground/50 underline-offset-2 hover:text-foreground"
            onClick={(event) => {
              event.preventDefault();
              openSnippetInPopup(reference.id);
            }}
          >
            {reference.label}
          </a>
        </Fragment>
      ))}
    </>
  );
}

function SavedIndicator({ id }: { id: string }) {
  return (
    <span
      data-testid={`image-saved-${id}`}
      role="status"
      aria-label={i18n.t("options.row.saved")}
      title={i18n.t("options.row.saved")}
      className="flex size-6 shrink-0 items-center justify-center text-green-600 dark:text-green-400"
    >
      <Icon icon={Check} stroke="emphasis" />
    </span>
  );
}

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

  // The load owns its object URLs and the description timers now, so teardown
  // has to release both. A load resolving after unmount would otherwise create
  // URLs nobody revokes; a queued description write must be committed, not
  // dropped, because switching sections keeps the store alive.
  useEffect(() => {
    void loadMediaLibrary();
    return () => {
      disposeObjectUrls();
      void flushPendingAltSaves();
    };
  }, []);

  const totalBytes = totalMediaBytes(items);
  const totalPercent = Math.min(
    100,
    Math.round((totalBytes / MEDIA_LIMITS.MAX_TOTAL_SIZE) * 100)
  );
  const storageTight = totalPercent >= 80;

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
        <dl
          data-testid="image-total-storage"
          className="flex items-center gap-3 rounded-lg border border-border/70 bg-muted/30 p-4"
        >
          <Icon
            icon={Images}
            className="size-4 shrink-0 text-muted-foreground"
          />
          <dt className="min-w-0 flex-1 text-xs text-muted-foreground">
            {i18n.t("options.images.totalStorage")}
          </dt>
          <Progress
            value={totalPercent}
            aria-label={i18n.t("options.images.totalStorage")}
            className={cn(
              "w-20 shrink-0 gap-0 [&_[data-slot=progress-track]]:h-1.5 [&_[data-slot=progress-track]]:rounded-full [&_[data-slot=progress-track]]:bg-muted [&_[data-slot=progress-indicator]]:rounded-full",
              storageTight && "[&_[data-slot=progress-indicator]]:bg-amber-500"
            )}
          />
          <dd className="w-28 shrink-0 text-right text-xs tabular-nums text-foreground">
            {formatBytes(totalBytes)} /{" "}
            {formatBytes(MEDIA_LIMITS.MAX_TOTAL_SIZE)}
          </dd>
          <dd className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {i18n.t("options.storage.roomLeft", [
              formatBytes(
                Math.max(0, MEDIA_LIMITS.MAX_TOTAL_SIZE - totalBytes)
              ),
            ])}
          </dd>
        </dl>
      )}

      {loadError && (
        <InlineError
          message={loadError}
          onDismiss={dismissLoadError}
          className="rounded-lg border border-red-200 dark:border-red-800"
        />
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Spinner className="size-4" />
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
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-ui-micro! text-muted-foreground">
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
                  <p className="text-ui-micro! text-muted-foreground">
                    <ReferencedBy references={item.referencingSnippets} />
                  </p>
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <Input
                      type="text"
                      value={altDraft[item.meta.id] ?? ""}
                      onChange={(e) => {
                        setAltDraft(item.meta.id, e.target.value);
                        scheduleAltSave(item.meta.id);
                      }}
                      placeholder={i18n.t("options.images.altText.placeholder")}
                      aria-label={`${i18n.t("options.images.altText.label")} ${item.meta.id}`}
                      className="h-7 text-ui-micro! flex-1"
                    />
                    {altSaved[item.meta.id] && (
                      <SavedIndicator id={item.meta.id} />
                    )}
                  </div>
                  {altErrors[item.meta.id] && (
                    <p className="text-ui-micro! text-red-600 dark:text-red-400">
                      {altErrors[item.meta.id]}
                    </p>
                  )}
                  {deleteErrors[item.meta.id] && (
                    <p className="text-ui-micro! text-red-600 dark:text-red-400">
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
                  <div className="flex items-center gap-1.5 text-ui-micro! text-muted-foreground">
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
                  <p className="text-ui-micro! text-muted-foreground truncate">
                    <ReferencedBy references={item.referencingSnippets} />
                  </p>
                  <div className="flex items-center gap-1 pt-0.5">
                    <Input
                      type="text"
                      value={altDraft[item.meta.id] ?? ""}
                      onChange={(e) => {
                        setAltDraft(item.meta.id, e.target.value);
                        scheduleAltSave(item.meta.id);
                      }}
                      placeholder={i18n.t("options.images.altText.placeholder")}
                      aria-label={`${i18n.t("options.images.altText.label")} ${item.meta.id}`}
                      className="h-6 text-ui-micro! flex-1 px-1.5"
                    />
                    {altSaved[item.meta.id] && (
                      <SavedIndicator id={item.meta.id} />
                    )}
                  </div>
                  {altErrors[item.meta.id] && (
                    <p className="text-ui-micro! text-red-600 dark:text-red-400">
                      {altErrors[item.meta.id]}
                    </p>
                  )}
                  {deleteErrors[item.meta.id] && (
                    <p className="text-ui-micro! text-red-600 dark:text-red-400">
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
        <AlertDialog
          open
          onOpenChange={(next) => {
            if (!next) cancelDelete();
          }}
        >
          <AlertDialogContent className="max-w-sm p-6">
            <div className="flex items-start gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/40">
                <Icon
                  icon={Trash2}
                  size="lg"
                  className="text-red-600 dark:text-red-400"
                />
              </div>
              <div className="space-y-1">
                <AlertDialogTitle
                  id="delete-confirm-title"
                  className="text-sm font-semibold text-foreground"
                >
                  {i18n.t("options.images.deleteConfirmTitle")}
                </AlertDialogTitle>
                <AlertDialogDescription className="text-xs">
                  {confirmItem.referencingSnippets.length > 0
                    ? i18n.t("options.images.deleteConfirmMessage", [
                        confirmItem.referencingSnippets.length,
                      ])
                    : i18n.t("options.images.deleteConfirmMessageNoRefs")}
                </AlertDialogDescription>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <AlertDialogCancel size="sm">
                {i18n.t("common.cancel")}
              </AlertDialogCancel>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => void removeMedia(confirmItem.meta.id)}
              >
                {i18n.t("options.images.deleteButton")}
              </Button>
            </div>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
