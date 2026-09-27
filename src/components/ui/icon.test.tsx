import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Settings, X, Film, Loader2 } from "lucide-react";
import { Icon } from "./icon";
import { ICON_SIZE, ICON_STROKE } from "@/lib/icons";

const render = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("Icon", () => {
  it("renders an svg via the icon-as-prop pattern", () => {
    const html = render(<Icon icon={Settings} />);
    expect(html).toContain("<svg");
    expect(html).toContain("lucide-settings");
  });

  it("applies the md default size and shrink-0", () => {
    const html = render(<Icon icon={Settings} />);
    expect(html).toContain(ICON_SIZE.md);
    expect(html).toContain("shrink-0");
  });

  it.each([
    ["xs", "size-2.5"],
    ["sm", "size-3"],
    ["md", "size-3.5"],
    ["lg", "size-4"],
    ["xl", "size-5"],
    ["2xl", "size-6"],
    ["3xl", "size-8"],
  ] as const)("size=%s emits %s", (size, cls) => {
    const html = render(<Icon icon={Settings} size={size} />);
    expect(html).toContain(cls);
  });

  it("hides the icon from assistive technology", () => {
    const html = render(<Icon icon={Settings} />);
    expect(html).toContain('aria-hidden="true"');
  });

  it("defaults to the 1.5 stroke", () => {
    const html = render(<Icon icon={Settings} />);
    expect(html).toContain('stroke-width="1.5"');
  });

  it("uses the 2 stroke for the explicit emphasis variant", () => {
    const html = render(<Icon icon={X} stroke="emphasis" />);
    expect(html).toContain('stroke-width="2"');
  });

  it("supports the documented micro stroke escape hatch", () => {
    const html = render(
      <Icon icon={Film} size="xs" strokeWidth={ICON_STROKE.micro} />
    );
    expect(html).toContain('stroke-width="2.5"');
    expect(html).toContain(ICON_SIZE.xs);
  });

  it("merges className for color, animation, and spacing", () => {
    const html = render(
      <Icon
        icon={Loader2}
        className="animate-spin text-muted-foreground mr-1.5"
      />
    );
    expect(html).toContain("animate-spin");
    expect(html).toContain("text-muted-foreground");
    expect(html).toContain("mr-1.5");
  });

  it("supports the non-square override (GripVertical: size token + h-8 w-3)", () => {
    // Asserts the class merge keeps size-3 alongside h-8/w-3.
    // Visual precedence (h-8/w-3 winning over size-3) is a CSS-order
    // concern covered by e2e / manual review, not this unit test.
    const html = render(<Icon icon={Settings} size="sm" className="h-8 w-3" />);
    expect(html).toContain("size-3");
    expect(html).toContain("h-8");
    expect(html).toContain("w-3");
  });

  it("keeps shrink-0 even when className is provided", () => {
    const html = render(<Icon icon={Settings} className="text-green-600" />);
    expect(html).toContain("shrink-0");
    expect(html).toContain("text-green-600");
  });

  it("does not emit an aria-label (labels belong on the wrapper button)", () => {
    const html = render(<Icon icon={X} />);
    expect(html).not.toContain("aria-label");
    expect(html).not.toContain("role=");
  });
});
