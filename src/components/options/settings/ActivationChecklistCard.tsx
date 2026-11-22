/**
 * The options rail's home for the first-success checklist.
 *
 * Options does not otherwise read the snippets store, so this is the one place
 * that loads it here. Going through the store rather than a one-off
 * `getSnippets()` keeps the checklist live when a snippet is created or edited
 * in the popup while Options is open — the store already listens to snippet
 * keys in every storage area.
 */

import { useEffect } from "react";

import { ActivationChecklist } from "@/components/onboarding/ActivationChecklist";
import { loadSnippets, useSnippets } from "@/store/snippets";

export function ActivationChecklistCard() {
  const snippets = useSnippets((state) => state.snippets);

  useEffect(() => {
    void loadSnippets();
  }, []);

  return <ActivationChecklist snippets={snippets} />;
}
