import { useState, useEffect } from "react";
import { Moon, Sun, Monitor, Sparkles } from "lucide-react";
import confetti from "canvas-confetti";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTheme, type ThemeMode } from "@/hooks/ThemeContext";
import { confettiEnabledItem } from "@/storage/items";
import { i18n } from "#i18n";

export function AppearanceSection() {
  const { themeMode, setThemeMode } = useTheme();

  const [confettiEnabled, setConfettiEnabled] = useState(true);

  useEffect(() => {
    confettiEnabledItem
      .getValue()
      .then((val) => {
        if (val === false) {
          setConfettiEnabled(false);
        }
      })
      .catch(console.warn);
  }, []);

  const handleConfettiToggle = (enabled: boolean) => {
    setConfettiEnabled(enabled);
    confettiEnabledItem.setValue(enabled).catch(console.warn);
  };

  const handlePreviewConfetti = () => {
    confetti({
      particleCount: 80,
      spread: 90,
      origin: { x: 0.5, y: 0.6 },
      colors: [
        "#6366f1",
        "#8b5cf6",
        "#ec4899",
        "#f59e0b",
        "#10b981",
        "#3b82f6",
      ],
      ticks: 100,
      gravity: 1.1,
      scalar: 0.9,
    });
  };

  const THEME_OPTIONS: {
    mode: ThemeMode;
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      mode: "light",
      label: i18n.t("options.theme.light"),
      icon: <Sun className="h-5 w-5" strokeWidth={1.5} />,
    },
    {
      mode: "dark",
      label: i18n.t("options.theme.dark"),
      icon: <Moon className="h-5 w-5" strokeWidth={1.5} />,
    },
    {
      mode: "system",
      label: i18n.t("options.theme.system"),
      icon: <Monitor className="h-5 w-5" strokeWidth={1.5} />,
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">
          {i18n.t("options.nav.appearance")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {i18n.t("options.appearance.description")}
        </p>
      </div>

      <div className="rounded-xl border p-5 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            {i18n.t("options.appearance.themeTitle")}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {i18n.t("options.appearance.themeDescription")}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {THEME_OPTIONS.map(({ mode, label, icon }) => {
            const active = themeMode === mode;
            return (
              <button
                key={mode}
                onClick={() => setThemeMode(mode)}
                className={cn(
                  "flex flex-col items-center justify-center gap-2.5 rounded-xl border p-4 text-sm transition-all duration-150",
                  active
                    ? "border-foreground bg-background shadow-sm font-medium text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
              >
                <span
                  className={cn(
                    "transition-colors",
                    active ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {icon}
                </span>
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <h3 className="text-sm font-medium text-foreground flex items-center gap-1.5">
              <Sparkles
                className="h-3.5 w-3.5 text-muted-foreground"
                strokeWidth={1.5}
              />
              {i18n.t("options.appearance.confettiTitle")}
            </h3>
            <p className="text-xs text-muted-foreground">
              {i18n.t("options.appearance.confettiDescription")}
            </p>
          </div>

          <button
            role="switch"
            aria-checked={confettiEnabled}
            onClick={() => handleConfettiToggle(!confettiEnabled)}
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              confettiEnabled ? "bg-foreground" : "bg-input"
            )}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow-lg transition-transform duration-200",
                confettiEnabled ? "translate-x-4" : "translate-x-0"
              )}
            />
          </button>
        </div>

        <div className="rounded-lg bg-muted/50 border border-dashed p-4 flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            {confettiEnabled
              ? i18n.t("options.appearance.confettiPreviewHint")
              : i18n.t("options.appearance.confettiDisabledHint")}
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={!confettiEnabled}
            onClick={handlePreviewConfetti}
            className="shrink-0 gap-1.5"
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
            {i18n.t("options.appearance.confettiPreviewButton")}
          </Button>
        </div>
      </div>
    </div>
  );
}
