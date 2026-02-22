import { useState } from "react";
import { Save, X, PanelLeftClose, PanelLeft } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { RichTextEditor } from "~/components/editor";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { InlineError } from "~/components/ui/inline-error";
import type { SnippetFormData } from "~/types";
import { i18n } from "#i18n";

interface NewSnippetViewProps {
  draftSnippet: SnippetFormData;
  onDraftChange: (draft: SnippetFormData) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
  createError?: string | null;
  onClearCreateError?: () => void;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

export default function NewSnippetView({
  draftSnippet,
  onDraftChange,
  onSave,
  onCancel,
  isSaving,
  createError = null,
  onClearCreateError,
  sidebarOpen = true,
  onToggleSidebar,
}: NewSnippetViewProps) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;

    // Validate shortcut - no spaces allowed
    if (name === "shortcut" && value.includes(" ")) {
      setErrors({ ...errors, shortcut: i18n.t("newSnippet.shortcutError") });
      return;
    } else if (name === "shortcut") {
      setErrors({ ...errors, shortcut: "" });
    }

    onDraftChange({ ...draftSnippet, [name]: value });
  };

  const canSave =
    draftSnippet.label.trim() &&
    draftSnippet.shortcut.trim() &&
    draftSnippet.content.trim() &&
    !errors.shortcut;

  return (
    <div className="flex flex-col h-full">
      {/* Action Bar */}
      <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleSidebar}
          className="h-8 w-8"
          title={
            sidebarOpen
              ? i18n.t("common.hideSidebar")
              : i18n.t("common.showSidebar")
          }
          aria-label={
            sidebarOpen
              ? i18n.t("common.hideSidebar")
              : i18n.t("common.showSidebar")
          }
        >
          {sidebarOpen ? (
            <PanelLeftClose className="h-3.5 w-3.5" strokeWidth={1.5} />
          ) : (
            <PanelLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
          )}
        </Button>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          onClick={onCancel}
          className="h-8 w-8"
          title={i18n.t("newSnippet.cancel")}
          aria-label={i18n.t("newSnippet.cancel")}
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>
        <Separator orientation="vertical" className="h-5 mx-1" />
        <Button
          variant="default"
          size="sm"
          onClick={onSave}
          disabled={!canSave || isSaving}
          className="h-8 text-xs"
        >
          <Save className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
          {isSaving
            ? i18n.t("newSnippet.creating")
            : i18n.t("newSnippet.create")}
        </Button>
      </div>

      {/* Inline error — shown when snippet creation fails */}
      <InlineError
        message={createError}
        onDismiss={() => onClearCreateError?.()}
      />

      {/* Form Content */}
      <div className="flex-1 overflow-auto p-3 space-y-4">
        {/* Name Field */}
        <div className="space-y-1.5">
          <Label htmlFor="label" className="text-xs font-medium">
            {i18n.t("newSnippet.name")}
          </Label>
          <Input
            id="label"
            name="label"
            type="text"
            placeholder={i18n.t("newSnippet.namePlaceholder")}
            value={draftSnippet.label}
            onChange={handleChange}
            className="h-8 text-sm"
          />
        </div>

        {/* Shortcut Field */}
        <div className="space-y-1.5">
          <Label htmlFor="shortcut" className="text-xs font-medium">
            {i18n.t("newSnippet.shortcut")}
          </Label>
          <Input
            id="shortcut"
            name="shortcut"
            type="text"
            placeholder={i18n.t("newSnippet.shortcutPlaceholder")}
            value={draftSnippet.shortcut}
            onChange={handleChange}
            aria-describedby={errors.shortcut ? "shortcut-error" : undefined}
            aria-invalid={!!errors.shortcut}
            className={`h-8 text-sm font-mono ${errors.shortcut ? "border-red-500" : ""}`}
          />
          {errors.shortcut && (
            <p
              id="shortcut-error"
              role="alert"
              className="text-xs text-red-500"
            >
              {errors.shortcut}
            </p>
          )}
        </div>

        {/* Content Field */}
        <div className="space-y-1.5 flex-1">
          <Label htmlFor="content" className="text-xs font-medium">
            {i18n.t("newSnippet.content")}
          </Label>
          <div className="min-h-50 border border-zinc-200 dark:border-zinc-800 rounded-md p-2">
            <RichTextEditor
              value={draftSnippet.content}
              onChange={(value) =>
                onDraftChange({ ...draftSnippet, content: value })
              }
              placeholder={i18n.t("newSnippet.contentPlaceholder")}
              className="text-sm"
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <Separator />
      <div className="px-3 py-2 flex items-center justify-center text-xs text-zinc-500 dark:text-zinc-400">
        <span>{i18n.t("newSnippet.footer")}</span>
      </div>
    </div>
  );
}
