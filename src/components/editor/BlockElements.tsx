/**
 * Renderers for the block elements the markdown grammar produces.
 *
 *
 * The block grammar (Wave 10) taught `deserializeContent` to emit `h1`–`h6`,
 * `ul`/`ol`/`li`, `blockquote`, `hr`, `code` and `table`/`thead`/`tbody`/`tr`/
 * `th`/`td`. Plate renders nothing for an element it has no component for, so
 * without these a snippet containing a heading or a list would open in the
 * editor showing *nothing* — the content was saved correctly and then made
 * invisible. An e2e test caught exactly that.
 *
 * These are deliberately presentational, not full editors:
 *
 * - `@platejs/list` and `@platejs/table` are not dependencies, and adding them
 *   for a snippet editor is a real cost in bundle size and supply chain.
 * - What matters is that the content is *visible* and survives a round trip.
 *   Rich table editing (add/remove rows, resize columns) is a feature, not a
 *   correctness requirement.
 *
 * The list and table renderers read their nesting from `element.children`, so
 * the markup is semantic and the content stays editable as text.
 */

import { createPlatePlugin } from "platejs/react";
import type { PlateElementProps } from "platejs/react";
import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useControlConfirmation } from "@/components/feedback/use-control-confirmation";
import { codeBlockText } from "@/lib/editor-code-block";
import { i18n } from "#i18n";

type El = { type?: string; children?: unknown[]; language?: string };

/** Shared plumbing: pass Plate's attributes and children through untouched. */
function Block({
  attributes,
  children,
  className,
  as: Tag = "div",
  ...rest
}: PlateElementProps & {
  className?: string;
  as?:
    | "div"
    | "h1"
    | "h2"
    | "h3"
    | "h4"
    | "h5"
    | "h6"
    | "ul"
    | "ol"
    | "li"
    | "pre"
    | "blockquote";
  language?: string;
  style?: React.CSSProperties;
  /** `start` on an `<ol>`. Not part of PlateElementProps, so it is declared here. */
  start?: number;
}) {
  // `start` and `language` are ours, not Plate's, and must not be spread onto
  // the DOM node as unknown attributes.
  const {
    start: _start,
    language: _language,
    ...domProps
  } = rest as {
    start?: number;
    language?: string;
  } & Record<string, unknown>;
  void _language;

  return (
    <Tag
      {...attributes}
      className={className}
      {...(domProps as React.HTMLAttributes<HTMLElement>)}
    >
      {children}
    </Tag>
  );
}

const HEADING_CLASS: Record<string, string> = {
  h1: "text-2xl font-semibold my-3",
  h2: "text-xl font-semibold my-3",
  h3: "text-lg font-semibold my-2",
  h4: "text-base font-semibold my-2",
  h5: "text-sm font-semibold my-2",
  h6: "text-xs font-semibold my-2 text-muted-foreground",
};

export function HeadingElement(props: PlateElementProps) {
  const type = (props.element as El).type ?? "p";
  const level = type.replace("h", "");
  const Tag = (`h${level}` in HEADING_CLASS ? `h${level}` : "h6") as "h6";
  return (
    <Block
      {...props}
      as={Tag}
      className={HEADING_CLASS[Tag] ?? HEADING_CLASS.h6}
    />
  );
}

export function BlockquoteElement(props: PlateElementProps) {
  return (
    <Block
      {...props}
      as="blockquote"
      className="border-l-2 border-indigo-400 pl-3 my-2 text-muted-foreground"
    />
  );
}

export function HrElement(props: PlateElementProps) {
  return (
    <div {...props.attributes} className="my-3" contentEditable={false}>
      <hr className="border-border" />
    </div>
  );
}

/**
 * A fenced code block, rendered with Plate's own editable children.
 *
 * shadcn has no code-block primitive, and adding a highlighter plugin would put a
 * large dependency in the popup for a feature that only needs a readable,
 * copyable block. The Slate node stays editable; the header is presentational
 * chrome with `contentEditable={false}`.
 */
export function CodeBlockElement(props: PlateElementProps) {
  const language = (props.element as El).language;
  const [copyFailed, setCopyFailed] = useState(false);
  const { confirmed, show, reset } = useControlConfirmation();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codeBlockText(props.element));
      setCopyFailed(false);
      show();
    } catch {
      // Keep the original label so a failure is visible as "Copy code" rather
      // than a false "Copied" tick.
      reset();
      setCopyFailed(true);
    }
  };

  const copyLabel = i18n.t(
    confirmed ? "editor.codeBlock.copied" : "editor.codeBlock.copy"
  );

  return (
    <div
      {...props.attributes}
      data-testid="code-block"
      className="my-3 overflow-hidden rounded-lg border border-border bg-muted/40"
    >
      <div
        contentEditable={false}
        className="flex items-center justify-between gap-2 border-b border-border px-2 py-1"
      >
        <span className="font-mono text-ui-micro! uppercase tracking-wide text-muted-foreground">
          {language || i18n.t("editor.codeBlock.label")}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="code-block-copy"
          title={copyLabel}
          aria-label={copyLabel}
          // The button is inside the editable surface. Preventing mousedown
          // from moving the caret keeps the block's selection intact while Base
          // UI-style buttons still receive the click.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void copy()}
          className="h-6 gap-1 px-1.5 text-ui-micro!"
        >
          <Icon icon={confirmed ? Check : Copy} size="xs" />
          {copyLabel}
        </Button>
      </div>
      <pre className="overflow-x-auto px-3 py-2 font-mono text-ui-xs!">
        <code data-language={language || undefined}>{props.children}</code>
      </pre>
      {copyFailed && (
        <span
          contentEditable={false}
          role="status"
          className="sr-only"
          data-testid="code-block-copy-error"
        >
          {i18n.t("editor.codeBlock.copyFailed")}
        </span>
      )}
    </div>
  );
}

export function ListElement(props: PlateElementProps) {
  const ordered = (props.element as El).type === "ol";
  const start = (props.element as El & { start?: number }).start;
  return (
    <Block
      {...props}
      as={ordered ? "ol" : "ul"}
      className={
        ordered
          ? "list-decimal pl-5 my-2 space-y-0.5"
          : "list-disc pl-5 my-2 space-y-0.5"
      }
      start={ordered && start && start !== 1 ? start : undefined}
    />
  );
}

export function ListItemElement(props: PlateElementProps) {
  return <Block {...props} as="li" className="leading-relaxed" />;
}

export function TableElement(props: PlateElementProps) {
  return (
    <div {...props.attributes} className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{props.children}</table>
    </div>
  );
}

export function TableSectionElement(props: PlateElementProps) {
  return <>{props.children}</>;
}

export function TableRowElement(props: PlateElementProps) {
  return (
    <tr {...props.attributes} className="border-b border-border last:border-0">
      {props.children}
    </tr>
  );
}

export function TableCellElement(props: PlateElementProps) {
  const element = props.element as El & { align?: "left" | "center" | "right" };
  const isHeader = element.type === "th";
  const Tag = isHeader ? "th" : "td";
  return (
    <Tag
      {...props.attributes}
      className="border border-border px-2 py-1 align-top"
      style={element.align ? { textAlign: element.align } : undefined}
    >
      {props.children}
    </Tag>
  );
}

/**
 * Paragraph blocks need their own spacing.
 *
 * A blank line in the markdown is represented as a block boundary, not as an
 * empty Slate node: `parseBlocks` skips blank lines and `serializeToMarkdown`
 * joins blocks with `\n\n`. Plate's default paragraph renders as a bare div,
 * so reopening a saved snippet showed those blocks glued together even though
 * the stored text — and the text inserted into a page — kept the blank line.
 */
export function ParagraphElement(props: PlateElementProps) {
  return (
    <div
      {...props.attributes}
      data-testid="clipio-editor-paragraph"
      className="mb-3 last:mb-0"
    >
      {props.children}
    </div>
  );
}

/** Renderer for each block type. */
const BLOCK_COMPONENTS: Record<
  string,
  (props: PlateElementProps) => ReactNode
> = {
  h1: HeadingElement,
  h2: HeadingElement,
  h3: HeadingElement,
  h4: HeadingElement,
  h5: HeadingElement,
  h6: HeadingElement,
  blockquote: BlockquoteElement,
  hr: HrElement,
  code_block: CodeBlockElement,
  ul: ListElement,
  ol: ListElement,
  li: ListItemElement,
  table: TableElement,
  thead: TableSectionElement,
  tbody: TableSectionElement,
  tfoot: TableSectionElement,
  tr: TableRowElement,
  th: TableCellElement,
  td: TableCellElement,
};

/**
 * One plugin per block type.
 *
 * Registered as plugins rather than through `override.components` or
 * `renderElement`, because that is the mechanism this editor already proves
 * works: `LinkPlugin.withComponent(LinkElementComponent)` renders, while the
 * same map in `override.components` was silently ignored — the grammar's blocks
 * deserialised correctly and then rendered as bare `data-slate-node` divs with
 * no component at all, so a heading or list was invisible in the editor.
 *
 * The e2e test that checks the editor actually shows an `<h2>` is what caught
 * that; a unit test on the parser would not have.
 */
export const BLOCK_PLUGINS = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "hr",
  "code_block",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
].map((key) => {
  const plugin = createPlatePlugin({
    key,
    node: { isElement: true, isInline: false, isVoid: key === "hr" },
  });
  return plugin.withComponent(BLOCK_COMPONENTS[key] as never);
});
