import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteFavicon } from "./SiteFavicon";

describe("SiteFavicon", () => {
  it("strips a wildcard prefix from the hostname", () => {
    const { container } = render(<SiteFavicon hostname="*.example.com" />);

    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://www.google.com/s2/favicons?domain=example.com&sz=16"
    );
  });

  it("uses a plain hostname unchanged", () => {
    const { container } = render(<SiteFavicon hostname="example.org" />);

    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://www.google.com/s2/favicons?domain=example.org&sz=16"
    );
  });

  it("falls back to a globe when the favicon fails to load", () => {
    const { container } = render(<SiteFavicon hostname="example.com" />);
    const image = container.querySelector("img")!;

    fireEvent.error(image);

    // A broken remote favicon must not leave a broken-image icon on screen.
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
