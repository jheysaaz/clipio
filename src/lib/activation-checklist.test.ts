import { describe, expect, it } from "vitest";

import type { Snippet } from "@/types";
import {
  activationChecklist,
  type ActivationInput,
} from "./activation-checklist";
import type { OnboardingProgress } from "./onboarding-progress";

function snippet(overrides: Partial<Snippet> = {}): Snippet {
  return {
    id: "s1",
    label: "First",
    shortcut: "/first",
    content: "hello",
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    usageCount: 0,
    ...overrides,
  };
}

function input(overrides: Partial<ActivationInput> = {}): ActivationInput {
  return {
    snippets: [],
    usageCounts: {},
    onboarding: { status: "completed" },
    dismissed: false,
    isLoaded: true,
    ...overrides,
  };
}

function doneIds(result: ReturnType<typeof activationChecklist>): string[] {
  return result.steps.filter((step) => step.done).map((step) => step.id);
}

describe("activationChecklist", () => {
  it("starts with no steps done for a new library", () => {
    const result = activationChecklist(input());

    expect(result.visible).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.doneCount).toBe(0);
    expect(result.total).toBe(3);
    expect(doneIds(result)).toEqual([]);
  });

  it("marks creation and placeholder independently", () => {
    const withoutPlaceholder = activationChecklist(
      input({ snippets: [snippet()] })
    );
    expect(doneIds(withoutPlaceholder)).toEqual(["create"]);

    const withPlaceholder = activationChecklist(
      input({ snippets: [snippet({ content: "Paste {{clipboard}}" })] })
    );
    expect(doneIds(withPlaceholder)).toEqual(["create", "placeholder"]);
  });

  it("does not treat non-string content as a placeholder", () => {
    const corrupt = snippet();
    (corrupt as { content: unknown }).content = 42;

    expect(
      doneIds(activationChecklist(input({ snippets: [corrupt] })))
    ).toEqual(["create"]);
  });

  it.each([
    "{{clipboard}}",
    "{{cursor}}",
    "{{date:iso}}",
    "{{datepicker:2026-01-01}}",
    "Hello {{cursor}} world",
  ])("recognises the user-facing placeholder %s", (content) => {
    expect(
      doneIds(activationChecklist(input({ snippets: [snippet({ content })] })))
    ).toContain("placeholder");
  });

  it.each([
    "{{image:media-id}}",
    "{{gif:giphy-id}}",
    "{{raw_html:payload}}",
    "{{date:ISO}}",
    "{{datepicker:01/01/2026}}",
    "{{clipboard }}",
  ])("does not mistake %s for a user-facing placeholder", (content) => {
    expect(
      doneIds(activationChecklist(input({ snippets: [snippet({ content })] })))
    ).not.toContain("placeholder");
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, "1", null])(
    "does not count %s as an insertion",
    (value) => {
      expect(
        doneIds(
          activationChecklist(
            input({
              snippets: [snippet()],
              usageCounts: { s1: value as number },
            })
          )
        )
      ).not.toContain("insert");
    }
  );

  it("counts an insertion recorded for a snippet still in the library", () => {
    expect(
      doneIds(
        activationChecklist(
          input({
            snippets: [snippet()],
            usageCounts: { s1: 1 },
          })
        )
      )
    ).toEqual(["create", "insert"]);
  });

  it("counts a legacy usage count stored on the snippet", () => {
    expect(
      doneIds(
        activationChecklist(input({ snippets: [snippet({ usageCount: 3 })] }))
      )
    ).toContain("insert");
  });

  it("does not count a corrupt legacy usage count", () => {
    const corrupt = snippet({ usageCount: Number.NaN });
    (corrupt as { usageCount: unknown }).usageCount = "many";

    expect(
      doneIds(
        activationChecklist(input({ snippets: [corrupt], usageCounts: {} }))
      )
    ).not.toContain("insert");
  });

  it("forgets the insertion step when its snippet has been deleted", () => {
    const result = activationChecklist(
      input({ snippets: [], usageCounts: { "deleted-snippet": 4 } })
    );

    expect(result.visible).toBe(true);
    expect(result.doneCount).toBe(0);
    expect(doneIds(result)).toEqual([]);
  });

  it("hides once all three steps are done", () => {
    const result = activationChecklist(
      input({
        snippets: [snippet({ content: "Today: {{date:iso}}" })],
        usageCounts: { s1: 1 },
      })
    );

    expect(result.complete).toBe(true);
    expect(result.doneCount).toBe(3);
    expect(result.visible).toBe(false);
  });

  it("hides while the tour is in progress", () => {
    const onboarding: OnboardingProgress = {
      status: "in_progress",
      surface: "popup",
      step: 4,
    };

    expect(activationChecklist(input({ onboarding })).visible).toBe(false);
  });

  it.each<OnboardingProgress>([{ status: "not_started" }])(
    "hides before the tour starts",
    (onboarding) => {
      expect(activationChecklist(input({ onboarding })).visible).toBe(false);
    }
  );

  it("shows after either terminal tour state", () => {
    expect(
      activationChecklist(input({ onboarding: { status: "skipped" } })).visible
    ).toBe(true);
    expect(
      activationChecklist(input({ onboarding: { status: "completed" } }))
        .visible
    ).toBe(true);
  });

  it("stays hidden until persisted state has loaded", () => {
    const result = activationChecklist(input({ isLoaded: false }));

    expect(result.visible).toBe(false);
    expect(result.steps).toHaveLength(3);
  });

  it("stays hidden after dismissal", () => {
    expect(activationChecklist(input({ dismissed: true })).visible).toBe(false);
    // Anything other than the literal boolean true is not a dismissal.
    expect(activationChecklist(input({ dismissed: "true" })).visible).toBe(
      true
    );
  });
});
