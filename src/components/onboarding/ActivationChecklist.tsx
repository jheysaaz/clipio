/**
 * A compact first-success card for the options rail, shown after the tour
 * rather than as another step in it. Every value it renders comes from
 * `activationChecklist`; the component only maps step ids to their
 * already-translated labels.
 */

import { useEffect } from "react";
import { i18n } from "#i18n";
import { Check, Circle, X } from "lucide-react";

import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import {
  activationChecklist,
  type ActivationStepId,
} from "@/lib/activation-checklist";
import {
  dismissActivation,
  loadActivation,
  useActivation,
} from "@/store/activation";
import type { Snippet } from "@/types";

function stepLabel(id: ActivationStepId): string {
  switch (id) {
    case "create":
      return i18n.t("activation.steps.create");
    case "shortcut":
      return i18n.t("activation.steps.shortcut");
    case "insert":
      return i18n.t("activation.steps.insert");
  }
}

export type ActivationChecklistProps = {
  snippets: readonly Snippet[];
};

export function ActivationChecklist({ snippets }: ActivationChecklistProps) {
  const state = useActivation((current) => current);

  useEffect(() => {
    void loadActivation();
  }, []);

  const checklist = activationChecklist({
    snippets,
    totalInsertions: state.totalInsertions,
    onboarding: state.onboarding,
    dismissed: state.dismissed,
    isLoaded: state.isLoaded,
  });

  if (!checklist.visible) return null;

  return (
    <section
      data-testid="activation-checklist"
      aria-label={i18n.t("activation.title")}
      className="shrink-0 border-t border-border bg-muted/40 px-3 py-3"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium leading-tight text-foreground">
          {i18n.t("activation.title")}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-testid="activation-dismiss"
          aria-label={i18n.t("activation.dismiss")}
          title={i18n.t("activation.dismiss")}
          onClick={() => void dismissActivation()}
          className="-mr-1 -mt-1 h-6 w-6 shrink-0"
        >
          <Icon icon={X} size="sm" />
        </Button>
      </div>
      <p
        data-testid="activation-progress"
        className="mt-0.5 text-[10px] text-muted-foreground"
      >
        {i18n.t("activation.progress", [checklist.doneCount, checklist.total])}
      </p>
      <ul className="mt-2 space-y-1" aria-label={i18n.t("activation.title")}>
        {checklist.steps.map((step) => (
          <li
            key={step.id}
            data-testid={`activation-step-${step.id}`}
            data-done={step.done ? "true" : "false"}
            className="flex items-center gap-1.5 text-[11px] leading-tight text-muted-foreground"
          >
            <Icon
              icon={step.done ? Check : Circle}
              size="sm"
              className={
                step.done ? "text-primary" : "text-muted-foreground/50"
              }
            />
            <span className={step.done ? "line-through" : ""}>
              {stepLabel(step.id)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
