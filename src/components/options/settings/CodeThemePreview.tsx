/**
 * A live sample for the code-theme setting.
 *
 * The sample uses the same token ranges and CSS classes as an editable code
 * block, so it shows what the chosen preset really does rather than a static
 * screenshot that can drift from the editor.
 */

import { i18n } from "#i18n";

import {
  CODE_TOKEN_CLASS_NAMES,
  codeThemeSegments,
  type CodeTheme,
} from "@/lib/code-theme";
import { highlightCodeRanges } from "@/lib/editor-code-highlight";

/** Short enough to stay inside a settings row, long enough to show four tokens. */
const SAMPLE_CODE = `const answer = () => {
  // Pick a palette
  return 42;
};`;

const SAMPLE_SEGMENTS = codeThemeSegments(
  SAMPLE_CODE,
  highlightCodeRanges(SAMPLE_CODE, "javascript")
);

export function CodeThemePreview({
  theme,
  testId = "code-theme-preview",
}: {
  theme: CodeTheme;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      data-code-theme={theme}
      aria-label={i18n.t("options.codeTheme.sample")}
      className="w-full overflow-hidden rounded-md border border-border"
    >
      <pre className="code-block-code m-0 overflow-x-auto px-3 py-2 text-ui-xs! leading-relaxed">
        <code>
          {SAMPLE_SEGMENTS.map((segment, index) => (
            <span
              key={index}
              data-prism-token={segment.token}
              className={
                segment.token
                  ? CODE_TOKEN_CLASS_NAMES[segment.token]
                  : undefined
              }
            >
              {segment.text}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
