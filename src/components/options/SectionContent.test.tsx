/**
 * SectionContent is a router: it decides which bespoke panel a section renders
 * and where the debug log sits relative to the rows. The panels themselves are
 * replaced with markers so a failure here points at the routing table, not at
 * a panel's own storage reads.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./settings/panels/BlockedSitesPanel", () => ({
  BlockedSitesPanel: () => <div data-testid="child-blocked-sites" />,
}));
vi.mock("./settings/panels/StoragePanel", () => ({
  StoragePanel: () => <div data-testid="child-storage" />,
}));
vi.mock("./settings/panels/DiagnosticsPanel", () => ({
  DiagnosticsPanel: () => <div data-testid="child-diagnostics" />,
}));
vi.mock("./settings/panels/LibraryPanel", () => ({
  LibraryPanel: () => <div data-testid="child-library" />,
}));
vi.mock("./settings/panels/ImagesPanel", () => ({
  ImagesPanel: () => <div data-testid="child-images" />,
}));
vi.mock("./settings/panels/AboutPanel", () => ({
  AboutPanel: () => <div data-testid="child-about" />,
}));
vi.mock("./settings/panels/DebugLogPanel", () => ({
  DebugLogPanel: () => <div data-testid="child-debug-log" />,
}));

import { SectionContent, SectionFooter } from "./SectionContent";
import type { SectionId } from "./settings/registry";

const PANEL_BY_SECTION: Partial<Record<SectionId, string>> = {
  "blocked-sites": "child-blocked-sites",
  storage: "child-storage",
  diagnostics: "child-diagnostics",
  library: "child-library",
  images: "child-images",
  about: "child-about",
};

describe("SectionContent", () => {
  it("renders the panel owned by each content-heavy section", () => {
    for (const [section, testId] of Object.entries(PANEL_BY_SECTION)) {
      const { unmount } = render(
        <SectionContent section={section as SectionId} />
      );
      expect(screen.getByTestId(testId as string)).toBeInTheDocument();
      unmount();
    }
  });

  it("renders nothing for sections made only of registry rows", () => {
    for (const section of ["expansion", "appearance"] as const) {
      const { container, unmount } = render(
        <SectionContent section={section} />
      );
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});

describe("SectionFooter", () => {
  it("places the debug log below the diagnostics rows", () => {
    render(<SectionFooter section="diagnostics" />);

    expect(screen.getByTestId("child-debug-log")).toBeInTheDocument();
  });

  it("renders no footer for every other section", () => {
    for (const section of [
      "library",
      "images",
      "expansion",
      "blocked-sites",
      "appearance",
      "storage",
      "about",
    ] as const) {
      const { container, unmount } = render(
        <SectionFooter section={section} />
      );
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});
