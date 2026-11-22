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
    case "placeholder":
      return i18n.t("activation.steps.placeholder");
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
    usageCounts: state.usageCounts,
    onboarding: state.onboarding,
    dismissed: state.dismissed,
    isLoaded: state.isLoaded,
  });

  if (!checklist.visible) return null;

  return (
    <section
      data-testid="activation-checklist"
      aria-label={i18n.t("activation.title")}
      className="mx-2 mb-2 shrink-0 rounded-lg border border-border bg-card p-3 shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug text-foreground">
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
          className="-mr-1 -mt-1 h-7 w-7 shrink-0"
        >
          <Icon icon={X} size="md" />
        </Button>
      </div>
      <p
        data-testid="activation-progress"
        className="mt-0.5 text-xs text-muted-foreground"
      >
        {i18n.t("activation.progress", [checklist.doneCount, checklist.total])}
      </p>
      <ul className="mt-2 space-y-1" aria-label={i18n.t("activation.title")}>
        {checklist.steps.map((step) => (
          <li
            key={step.id}
            data-testid={`activation-step-${step.id}`}
            data-done={step.done ? "true" : "false"}
            className="flex items-center gap-2 text-xs leading-snug text-muted-foreground"
          >
            <Icon
              icon={step.done ? Check : Circle}
              size="md"
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
