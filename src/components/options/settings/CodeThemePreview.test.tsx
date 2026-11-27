import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CodeThemePreview } from "./CodeThemePreview";

describe("CodeThemePreview", () => {
  it("renders a real highlighted sample in the chosen palette", () => {
    render(<CodeThemePreview theme="twilight" />);

    const preview = screen.getByTestId("code-theme-preview");
    expect(preview).toHaveAttribute("data-code-theme", "twilight");
    expect(preview).toHaveAccessibleName("Code sample");
    expect(preview).toHaveTextContent("return 42;");
    expect(
      preview.querySelector('[data-prism-token="keyword"]')
    ).not.toBeNull();
    expect(preview.querySelector(".code-token-keyword")).not.toBeNull();
    expect(preview.querySelector(".code-token-number")).not.toBeNull();
  });
});
