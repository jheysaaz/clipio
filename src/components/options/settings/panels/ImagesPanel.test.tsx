import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/options/ImagesSection", () => ({
  ImagesSection: () => <div data-testid="child-images-section" />,
}));

import { ImagesPanel } from "./ImagesPanel";

describe("ImagesPanel", () => {
  it("mounts the media library inside the images panel", () => {
    render(<ImagesPanel />);

    expect(screen.getByTestId("panel-images")).toContainElement(
      screen.getByTestId("child-images-section")
    );
  });
});
