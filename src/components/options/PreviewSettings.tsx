import { useState, useEffect } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  snippetPreviewEnabledItem,
  snippetPreviewPrefixItem,
  snippetPreviewShortcutItem,
} from "@/storage/items";
import { InfoTooltip } from "./InfoTooltip";
import { toast } from "sonner";
import { i18n } from "#i18n";

export function PreviewSettings() {
  const [previewEnabled, setPreviewEnabled] = useState<boolean>(true);
  const [previewPrefix, setPreviewPrefix] = useState<string>("/");
  const [previewShortcut, setPreviewShortcut] =
    useState<string>("Ctrl+Shift+Space");

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [enabled, prefix, shortcut] = await Promise.all([
          snippetPreviewEnabledItem.getValue(),
          snippetPreviewPrefixItem.getValue(),
          snippetPreviewShortcutItem.getValue(),
        ]);
        setPreviewEnabled(enabled);
        setPreviewPrefix(prefix);
        setPreviewShortcut(shortcut);
      } catch (error) {
        console.warn("Failed to load preview settings:", error);
      }
    };
    loadSettings();
  }, []);

  const handleTogglePreview = async () => {
    try {
      const newEnabled = !previewEnabled;
      await snippetPreviewEnabledItem.setValue(newEnabled);
      setPreviewEnabled(newEnabled);
      toast.success(
        newEnabled
          ? i18n.t("options.previewSettings.enabled")
          : i18n.t("options.previewSettings.disabled")
      );
    } catch (error) {
      console.error("Failed to update preview enabled setting:", error);
    }
  };

  const handlePrefixChange = async (newPrefix: string) => {
    try {
      await snippetPreviewPrefixItem.setValue(newPrefix);
      setPreviewPrefix(newPrefix);
      toast.success(i18n.t("options.previewSettings.prefixUpdated"));
    } catch (error) {
      console.error("Failed to update preview prefix:", error);
    }
  };

  const handleShortcutChange = async (newShortcut: string) => {
    try {
      await snippetPreviewShortcutItem.setValue(newShortcut);
      setPreviewShortcut(newShortcut);
      toast.success(i18n.t("options.previewSettings.shortcutUpdated"));
    } catch (error) {
      console.error("Failed to update preview shortcut:", error);
    }
  };

  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground mb-1 flex items-center gap-2">
        Snippet Preview
        <InfoTooltip text="Configure the snippet preview feature that shows available snippets as you type" />
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        Show a preview menu when typing to quickly find and select snippets
      </p>

      <div className="rounded-xl border p-5 space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Enable Preview</Label>
            <p className="text-xs text-muted-foreground">
              Show snippet preview menu while typing
            </p>
          </div>
          <Button
            role="switch"
            aria-checked={previewEnabled}
            aria-label="Enable Preview"
            variant={previewEnabled ? "default" : "outline"}
            size="sm"
            onClick={handleTogglePreview}
            className="shrink-0"
          >
            {previewEnabled ? "Enabled" : "Disabled"}
          </Button>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Trigger Prefix</Label>
          <p className="text-xs text-muted-foreground">
            Character that triggers the preview menu. Leave empty to always show
            preview.
          </p>
          <div className="flex gap-2 items-center">
            <div className="relative flex-1 max-w-xs">
              <Search
                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"
                strokeWidth={1.5}
              />
              <Input
                type="text"
                placeholder="/"
                value={previewPrefix}
                onChange={(e) => setPreviewPrefix(e.target.value)}
                onBlur={() => handlePrefixChange(previewPrefix)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  }
                }}
                className="pl-8 h-9 text-sm font-mono"
                maxLength={5}
              />
            </div>
            <span className="text-xs text-muted-foreground">
              Example: Type "{previewPrefix}hello" to filter snippets
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Manual Trigger Shortcut</Label>
          <p className="text-xs text-muted-foreground">
            Keyboard shortcut to manually show all snippets
          </p>
          <div className="flex gap-2 items-center">
            <div className="relative flex-1 max-w-xs">
              <Input
                type="text"
                placeholder="Ctrl+Shift+Space"
                value={previewShortcut}
                onChange={(e) => setPreviewShortcut(e.target.value)}
                onBlur={() => handleShortcutChange(previewShortcut)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  }
                }}
                className="h-9 text-sm font-mono"
              />
            </div>
            <span className="text-xs text-muted-foreground">
              Use format: Ctrl+Shift+Space, Cmd+K, etc.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
