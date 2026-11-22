import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { highlightParts, SettingRow } from "./SettingRow";
import { i18n } from "../../../../tests/mocks/i18n";

/**
 * `highlightParts` turns search-index ranges into markup.
 *
 * These assert on rendered DOM rather than on React elements, because the
 * property that matters is the text a user sees: the ranges must reconstruct
 * the title exactly, in order, with no characters dropped or duplicated. An
 * off-by-one here silently corrupts a word, which is invisible in a shallow
 * element comparison and obvious in the rendered string.
 */

/** Text content of a container, with `<mark>` contents marked. */
function renderParts(text: string, ranges?: { start: number; end: number }[]) {
  const { container } = render(<p>{highlightParts(text, ranges)}</p>);
  const p = container.querySelector("p")!;
  const marks = [...p.querySelectorAll("mark")];
  return {
    text: p.textContent,
    marks: marks.map((m) => m.textContent),
    markCount: marks.length,
  };
}

describe("highlightParts", () => {
  it("returns the plain string when there is nothing to highlight", () => {
    expect(renderParts("Interface font", undefined).markCount).toBe(0);
    expect(renderParts("Interface font", []).markCount).toBe(0);
    expect(renderParts("Interface font", []).text).toBe("Interface font");
  });

  it("marks a single range and reconstructs the text exactly", () => {
    const r = renderParts("Interface font", [{ start: 0, end: 9 }]);
    expect(r.marks).toEqual(["Interface"]);
    expect(r.text).toBe("Interface font");
  });

  it("marks a range in the middle, keeping both sides intact", () => {
    const r = renderParts("Confetti on insert", [{ start: 9, end: 11 }]);
    expect(r.marks).toEqual(["on"]);
    expect(r.text).toBe("Confetti on insert");
  });

  it("marks a range at the very end", () => {
    const r = renderParts("Trigger prefix", [{ start: 8, end: 14 }]);
    expect(r.marks).toEqual(["prefix"]);
    expect(r.text).toBe("Trigger prefix");
  });

  it("marks several separate ranges", () => {
    const r = renderParts("Cloud storage quota", [
      { start: 0, end: 5 },
      { start: 14, end: 19 },
    ]);
    expect(r.marks).toEqual(["Cloud", "quota"]);
    expect(r.text).toBe("Cloud storage quota");
  });

  it("accepts ranges given out of order", () => {
    // The index emits them in query-token order, which is not necessarily
    // left-to-right in the title. Rendering them as given would nest or reverse
    // the marks.
    const r = renderParts("Cloud storage quota", [
      { start: 14, end: 19 },
      { start: 0, end: 5 },
    ]);
    expect(r.marks).toEqual(["Cloud", "quota"]);
    expect(r.text).toBe("Cloud storage quota");
  });

  it("merges overlapping ranges into one mark", () => {
    // A query token can match both a whole word and a camel-case part of it,
    // producing two hits over the same characters. Overlapping marks would
    // nest and break the reading order.
    const r = renderParts("OpenDyslexic", [
      { start: 0, end: 4 },
      { start: 0, end: 12 },
    ]);
    expect(r.markCount).toBe(1);
    expect(r.marks).toEqual(["OpenDyslexic"]);
    expect(r.text).toBe("OpenDyslexic");
  });

  it("merges adjacent ranges", () => {
    const r = renderParts("abcdef", [
      { start: 0, end: 3 },
      { start: 3, end: 6 },
    ]);
    expect(r.marks).toEqual(["abcdef"]);
  });

  it("ignores an empty range", () => {
    const r = renderParts("Interface", [{ start: 3, end: 3 }]);
    expect(r.markCount).toBe(0);
    expect(r.text).toBe("Interface");
  });

  it("ignores an inverted range", () => {
    const r = renderParts("Interface", [{ start: 6, end: 2 }]);
    expect(r.markCount).toBe(0);
    expect(r.text).toBe("Interface");
  });

  it("ignores a range that starts before the string", () => {
    // Defensive: a stale index could carry an offset from different copy. A
    // negative start would slice from the end and highlight nonsense.
    const r = renderParts("Interface", [{ start: -4, end: 4 }]);
    expect(r.markCount).toBe(0);
    expect(r.text).toBe("Interface");
  });

  it("ignores a range that runs past the end of the string", () => {
    const r = renderParts("Interface", [{ start: 0, end: 999 }]);
    expect(r.markCount).toBe(0);
    expect(r.text).toBe("Interface");
  });

  it("marks accented characters without corrupting them", () => {
    // The index tokenises the *unfolded* title, so ranges are offsets into the
    // accented original. Slicing a folded string instead would drop or shift
    // characters here.
    const title = "Temática avanzada";
    const r = renderParts(title, [{ start: 0, end: 8 }]);
    expect(r.marks).toEqual(["Temática"]);
    expect(r.text).toBe(title);
  });

  it("marks every character when the range spans the whole title", () => {
    const r = renderParts("Theme", [{ start: 0, end: 5 }]);
    expect(r.marks).toEqual(["Theme"]);
    expect(r.text).toBe("Theme");
  });

  it("handles an empty title", () => {
    const r = renderParts("", [{ start: 0, end: 3 }]);
    expect(r.markCount).toBe(0);
    expect(r.text).toBe("");
  });
});

describe("SettingRow", () => {
  it("renders a compact row without optional decoration", () => {
    render(
      <SettingRow title="Theme">
        <span data-testid="control" />
      </SettingRow>
    );

    expect(screen.getByText("Theme")).toBeInTheDocument();
    expect(screen.getByTestId("control")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toHaveTextContent("");
    expect(
      screen.queryByRole("button", {
        name: i18n.t("options.row.resetToDefault"),
      })
    ).not.toBeInTheDocument();
  });

  it("shows a saved tick and only enables reset for a changed value", () => {
    const onReset = vi.fn();
    const { rerender } = render(
      <SettingRow
        title="Prefix"
        description="Trigger"
        status="saved"
        testId="prefix-row"
        className="extra"
        onReset={onReset}
      >
        <span>control</span>
      </SettingRow>
    );

    expect(screen.getByTestId("prefix-row")).toHaveClass("extra");
    expect(screen.getByText("Trigger")).toBeInTheDocument();
    expect(screen.getByRole("status").querySelector("svg")).toBeInTheDocument();

    const reset = screen.getByRole("button", {
      name: i18n.t("options.row.resetToDefault"),
    });
    expect(reset).toBeDisabled();
    expect(reset).toHaveAttribute("data-testid", "prefix-row-reset");

    rerender(
      <SettingRow
        title="Prefix"
        description="Trigger"
        status="saved"
        testId="prefix-row"
        className="extra"
        onReset={onReset}
        canReset
      >
        <span>control</span>
      </SettingRow>
    );
    fireEvent.click(reset);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("reports a failed save with an alert beside the title", () => {
    render(
      <SettingRow title="Prefix" status="error" testId="prefix-row">
        <span>control</span>
      </SettingRow>
    );

    expect(screen.getByTestId("prefix-row-error")).toHaveTextContent(
      i18n.t("options.row.saveFailed")
    );
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});
