/**
 * Binds a registry entry to storage and renders its live control.
 *
 * One component serves both places a setting appears — inside its section and
 * inside search results — so a value changed from the search list is reflected
 * in the section behind it without a second source of truth.
 *
 * spec: specs/options-redesign.spec.md
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { Icon } from "@/components/ui/icon";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingRow } from "./SettingRow";
import { ShortcutRecorder } from "./ShortcutRecorder";
import { useTheme } from "@/hooks/ThemeContext";
import type { SettingEntry } from "./registry";
import { captureError } from "@/lib/sentry";
import { i18n } from "#i18n";

type Status = "idle" | "saving" | "saved" | "error";

/** Controls whose own state already communicates "saved". */
const IMMEDIATE_CONTROLS = new Set<SettingEntry["control"]>([
  "switch",
  "select",
  "icon-segment",
]);

/**
 * On failure, roll the control back to what storage actually holds.
 *
 * Settings apply instantly, so without this a failed write leaves the switch
 * showing the value the user asked for while storage kept the old one — the UI
 * would be lying, and the next visit would silently revert.
 */

export function SettingControl({ entry }: { entry: SettingEntry }) {
  const [value, setValue] = useState<unknown>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<Status>("idle");

  // Theme is the one setting whose effect is not storage: ThemeContext owns the
  // `dark` class on <html> and persists on its own. Writing the item directly
  // leaves the page visually unchanged until the next reload, so the change is
  // routed through the context instead. spec: specs/options-redesign.spec.md
  const { setThemeMode } = useTheme();

  // Guard against a slow initial read overwriting a value the user has already
  // changed by toggling the row before storage answered.
  const dirty = useRef(false);

  useEffect(() => {
    let cancelled = false;
    entry
      .useValue()
      .then((v) => {
        if (cancelled) return;
        if (!dirty.current) setValue(v);
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        captureError(err, { action: "setting.useValue", settingId: entry.id });
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [entry]);

  const persist = useCallback(
    async (next: unknown) => {
      setValue(next);
      dirty.current = true;
      setStatus("saving");
      try {
        // ThemeContext persists for us, so writing here too would be a
        // redundant second write with no reader.
        if (entry.id !== "theme") {
          await entry.setValue(next);
        }
        if (entry.id === "theme") {
          setThemeMode(next as "light" | "dark" | "system");
        }
        setStatus("saved");
        setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1500);
      } catch (err) {
        captureError(err, { action: "setting.setValue", settingId: entry.id });
        setStatus("error");
        // Re-read and restore, so the control stops showing a value that was
        // never persisted.
        entry
          .useValue()
          .then((actual) => setValue(actual))
          .catch(() => {
            /* keep the optimistic value; the row already reports the failure */
          });
      }
    },
    [entry, setThemeMode]
  );

  const handleReset = useCallback(() => {
    if (!entry.reset) return;
    const finish = (fresh: unknown) => {
      dirty.current = false;
      setValue(fresh);
      if (entry.id === "theme") {
        setThemeMode(fresh as "light" | "dark" | "system");
      }
      setStatus("saved");
      setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1500);
    };
    if (entry.id === "theme") {
      const fresh = entry.defaultValue;
      finish(fresh);
      return;
    }
    entry
      .reset()
      .then(() => entry.useValue())
      .then(finish)
      .catch((err) => {
        captureError(err, { action: "setting.reset", settingId: entry.id });
        setStatus("error");
      });
  }, [entry, setThemeMode]);

  const canReset = !!entry.reset && loaded && !isDefaultValue(entry, value);

  return (
    <SettingRow
      title={i18n.t(entry.titleKey)}
      description={i18n.t(entry.descKey)}
      testId={entry.testId}
      onReset={entry.reset ? handleReset : undefined}
      canReset={canReset}
      // A switch or select *is* its own confirmation — its position already
      // shows the result. The tick is for text fields, where a typed value has
      // no visible committed state. Errors always show, on every control.
      status={
        status === "error"
          ? "error"
          : status === "idle" || IMMEDIATE_CONTROLS.has(entry.control)
            ? null
            : status
      }
    >
      <Control
        entry={entry}
        value={value}
        loaded={loaded}
        onChange={persist}
        status={status}
      />
    </SettingRow>
  );
}

/**
 * Whether a value still equals the shipped default.
 *
 * Compares against the registry's declared `defaultValue` rather than calling
 * `reset()`, which would write storage to answer a rendering question.
 */
function isDefaultValue(entry: SettingEntry, value: unknown): boolean {
  if ("defaultValue" in entry) {
    return value === entry.defaultValue;
  }
  // No declared default: the row cannot prove it is dirty, so keep the reset
  // affordance hidden rather than offering a button that may do nothing.
  return true;
}

function Control({
  entry,
  value,
  loaded,
  onChange,
  status,
}: {
  entry: SettingEntry;
  value: unknown;
  loaded: boolean;
  onChange: (next: unknown) => void;
  status: Status;
}) {
  switch (entry.control) {
    case "switch":
      return (
        <Switch
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked)}
          aria-label={i18n.t(entry.titleKey)}
          data-testid={`${entry.testId}-switch`}
          disabled={!loaded}
        />
      );

    case "icon-segment": {
      const options = entry.options ?? [];
      const current = typeof value === "string" ? value : "";
      return (
        <div
          role="radiogroup"
          aria-label={i18n.t(entry.titleKey)}
          data-testid={`${entry.testId}-segment`}
          className="inline-flex h-8 items-center gap-0.5 rounded-lg bg-muted p-0.5"
        >
          {options.map((opt) => {
            const selected = opt.value === current;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={i18n.t(opt.labelKey)}
                title={i18n.t(opt.labelKey)}
                data-testid={`${entry.testId}-${opt.value}`}
                disabled={!loaded}
                onClick={() => onChange(opt.value)}
                className={
                  selected
                    ? "flex size-7 items-center justify-center rounded-md bg-background text-foreground shadow-sm"
                    : "flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                }
              >
                {opt.icon ? (
                  <Icon icon={opt.icon} size="md" />
                ) : (
                  i18n.t(opt.labelKey)
                )}
              </button>
            );
          })}
        </div>
      );
    }

    case "select": {
      const options = entry.options ?? [];
      // Base UI's SelectValue resolves the displayed label from `items`; without
      // it the trigger falls back to the raw value and renders "sync" / "dark"
      // instead of the translated label.
      const items = Object.fromEntries(
        options.map((o) => [o.value, i18n.t(o.labelKey)])
      );
      return (
        <Select
          items={items}
          value={typeof value === "string" ? value : ""}
          onValueChange={(next) => onChange(next)}
          disabled={!loaded}
        >
          <SelectTrigger
            className="h-8 w-full text-sm"
            data-testid={`${entry.testId}-select`}
            aria-label={i18n.t(entry.titleKey)}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => {
              // A font picker previews each face by rendering its own label in
              // it. `optionFonts` is data, so this control does not need to
              // know that a font is what it is being handed.
              const previewFont = entry.optionFonts?.[opt.value];
              const label = i18n.t(opt.labelKey);
              return (
                <SelectItem key={opt.value} value={opt.value}>
                  {previewFont ? (
                    <span style={{ fontFamily: previewFont }}>{label}</span>
                  ) : (
                    label
                  )}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      );
    }

    case "slider": {
      const range = entry.range ?? { min: 0, max: 100, step: 1 };
      const current = typeof value === "number" ? value : range.min;
      return (
        <div className="flex w-full items-center gap-3">
          <Slider
            value={[current]}
            // Base UI types the callback as `number | readonly number[]` because
            // it also serves range sliders; this is single-thumb, so take the
            // first thumb rather than casting the whole union.
            onValueChange={(next) =>
              onChange(Array.isArray(next) ? next[0] : next)
            }
            min={range.min}
            max={range.max}
            step={range.step}
            disabled={!loaded}
            aria-label={i18n.t(entry.titleKey)}
            className="flex-1"
          />
          <span
            className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground"
            data-testid={`${entry.testId}-value`}
          >
            {i18n.t("options.slider.milliseconds", [String(current)])}
          </span>
        </div>
      );
    }

    case "shortcut":
      return (
        <ShortcutRecorder
          value={typeof value === "string" ? value : ""}
          onChange={(next) => onChange(next)}
          // Suffixed because the row already carries `entry.testId`; reusing it
          // here would put two elements under one test handle and make every
          // `getByTestId` a strict-mode violation.
          testId={`${entry.testId}-recorder`}
          disabled={!loaded}
        />
      );

    case "text":
      return (
        <Input
          // Only a declared secret is masked. The trigger prefix is a single
          // visible character and rendering it as dots makes the field
          // unreadable and uneditable.
          type={entry.secret ? "password" : "text"}
          value={typeof value === "string" ? value : ""}
          placeholder={entry.placeholder}
          disabled={!loaded}
          aria-label={i18n.t(entry.titleKey)}
          data-testid={`${entry.testId}-input`}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 font-mono text-xs"
        />
      );

    case "site-list":
      // Rendered by the section itself; a bare row would duplicate the list.
      return (
        <span className="text-xs text-muted-foreground">
          {status === "error"
            ? i18n.t("options.row.saveFailed")
            : i18n.t("options.row.managedInSection")}
        </span>
      );
  }
}
