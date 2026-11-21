/**
 * A quiet first-success strip, shown after the tour rather than as another step
 * in it. Every value it renders comes from `activationChecklist`; the component
 * only maps step ids to their already-translated labels.
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
      className="flex items-start gap-2 border-b bg-muted/40 px-3 py-2"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-medium text-foreground">
            {i18n.t("activation.title")}
          </p>
          <p
            data-testid="activation-progress"
            className="shrink-0 text-[10px] text-muted-foreground"
          >
            {i18n.t("activation.progress", [
              checklist.doneCount,
              checklist.total,
            ])}
          </p>
        </div>
        <ul
          className="mt-1 flex flex-col gap-0.5"
          aria-label={i18n.t("activation.title")}
        >
          {checklist.steps.map((step) => (
            <li
              key={step.id}
              data-testid={`activation-step-${step.id}`}
              data-done={step.done ? "true" : "false"}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
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
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        data-testid="activation-dismiss"
        aria-label={i18n.t("activation.dismiss")}
        title={i18n.t("activation.dismiss")}
        onClick={() => void dismissActivation()}
        className="h-6 w-6 shrink-0"
      >
        <Icon icon={X} size="sm" />
      </Button>
    </section>
  );
}
