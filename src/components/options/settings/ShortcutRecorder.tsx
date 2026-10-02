/**
 * Key-capturing shortcut recorder.
 *
 * Replaces the free-text field that previously asked users to type
 * `Ctrl+Shift+Space` by hand. Click to arm, press a chord, and it is captured
 * and stored in the platform-neutral `Mod+…` form.
 *
 * While armed the control owns the keyboard: it swallows Space and the arrows
 * so the page does not scroll, and Escape cancels without writing.
 *
 * spec: specs/options-redesign.spec.md
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Command,
  Keyboard,
  Option,
  ArrowUp,
} from "lucide-react";

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  parseShortcut,
  formatShortcut,
  shortcutSegments,
  shortcutFromEvent,
  currentPlatform,
  type ParsedShortcut,
} from "@/lib/shortcuts";
import { i18n } from "#i18n";

/**
 * Lucide glyph per modifier, keyed by `ShortcutSegment.kind`.
 *
 * Preferred over the `⌘⇧` symbols because they render identically on every
 * platform and at every size, and because they carry the same shape language as
 * the rest of the icon set. `Option` is the macOS spelling of Alt.
 */
const MODIFIER_ICONS = {
  command: Command,
  control: Keyboard,
  alt: Option,
  // This Lucide build ships no `Shift` glyph (and no icon whose name contains
  // "shift"), so the modifier falls back to an up arrow — the same shape the
  // ⇧ symbol conveys, drawn in the icon set's own stroke weight.
  shift: ArrowUp,
} as const;

/*
 * The trigger key is rendered as TEXT, never as an icon.
 *
 * Icons were tried here and are wrong for this slot: Lucide's `Space` glyph at
 * 12px reads as a plain dash, so `Mod+Shift+Space` looked like it had been set
 * to `Mod+Shift+-`. A keycap is named by its name. Icons are kept for the
 * modifiers, where the glyph is genuinely pictorial and platform-standard.
 */

type ArmState =
  | { armed: false }
  | { armed: true; error: string | null };

export function ShortcutRecorder({
  value,
  onChange,
  testId,
  disabled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  testId?: string;
  disabled?: boolean;
}) {
  const [state, setState] = useState<ArmState>({ armed: false });
  const buttonRef = useRef<HTMLButtonElement>(null);

  const parsed: ParsedShortcut | null = parseShortcut(value);
  const display = parsed
    ? formatShortcut(parsed, currentPlatform())
    : i18n.t("options.shortcut.unset");

  // The chord is read from `value` on every keystroke via a ref, so the
  // listener never needs re-binding while the user types. Written in an effect
  // rather than during render, which React forbids.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!state.armed) return;

      // Space and arrows would scroll the page underneath the recorder.
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setState({ armed: false });
        return;
      }

      const captured = shortcutFromEvent(event);
      if (!captured) {
        setState({
          armed: true,
          error: i18n.t("options.shortcut.needsModifier"),
        });
        return;
      }

      // Stored platform-neutral so a sync payload stays correct on the other
      // platform.
      onChangeRef.current(
        [
          captured.mod ? "Mod" : null,
          captured.alt ? "Alt" : null,
          captured.shift ? "Shift" : null,
          captured.key,
        ]
          .filter(Boolean)
          .join("+")
      );
      setState({ armed: false });
    },
    [state.armed]
  );

  useEffect(() => {
    if (!state.armed) return;
    // Capture phase: the page has its own keydown handlers (search focus on
    // `/`, for one) that would otherwise see the keystroke first.
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [state.armed, handleKeyDown]);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        ref={buttonRef}
        type="button"
        // Stays a button even while armed. It never becomes a text field — the
        // user types no characters into it, the keys are intercepted — so
        // flipping to role="textbox" would tell a screen reader the wrong thing
        // about what the control is.
        aria-label={i18n.t("options.shortcut.recorder")}
        aria-describedby={state.armed ? `${testId}-hint` : undefined}
        data-testid={testId}
        data-armed={state.armed ? "true" : "false"}
        disabled={disabled}
        onClick={() =>
          setState(state.armed ? { armed: false } : { armed: true, error: null })
        }
        onBlur={() => {
          // Blurring away mid-recording abandons the chord rather than
          // committing whatever happened to be held.
          if (state.armed) setState({ armed: false });
        }}
        className={cn(
          "inline-flex h-8 min-w-[9.5rem] items-center justify-center gap-2 rounded-lg border px-3 text-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          state.armed
            ? "border-ring bg-accent text-accent-foreground"
            : "bg-background text-foreground hover:bg-accent",
          disabled && "cursor-not-allowed opacity-50"
        )}
      >
        {state.armed ? (
          <span
            id={testId ? `${testId}-hint` : undefined}
            className="text-xs text-muted-foreground"
          >
            {i18n.t("options.shortcut.pressKeys")}
          </span>
        ) : parsed ? (
          <span className="flex items-center gap-1" data-testid={testId ? `${testId}-chord` : undefined}>
            {shortcutSegments(parsed).map((segment, i) => {
              const Glyph =
                segment.kind === "key"
                  ? null
                  : MODIFIER_ICONS[
                      segment.label as keyof typeof MODIFIER_ICONS
                    ];
              return (
                <kbd
                  key={`${segment.kind}-${i}`}
                  data-segment={segment.kind}
                  // `text-foreground/75`, not `text-muted-foreground`: muted on `bg-muted`
                // at 10px measures 4.39:1, under the 4.5:1 WCAG AA floor.
                // Caught by the per-section axe scan.
                className="flex h-5 min-w-5 items-center justify-center gap-0.5 rounded border border-border bg-muted px-1.5 text-foreground/75"
                >
                  {Glyph ? (
                    <Icon icon={Glyph} className="size-3" />
                  ) : (
                    <span className="font-mono text-[10px] leading-none">
                      {segment.label}
                    </span>
                  )}
                </kbd>
              );
            })}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icon icon={Keyboard} className="size-3.5" />
            {display}
          </span>
        )}
      </button>
      {state.armed && state.error && (
        <p
          role="alert"
          data-testid={`${testId ?? "shortcut"}-error`}
          className="text-xs text-destructive"
        >
          {state.error}
        </p>
      )}
    </div>
  );
}