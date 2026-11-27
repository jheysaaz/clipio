/**
 * Prism-backed token ranges for editable code blocks.
 *
 * Plate/Slate keeps the text itself, so this helper never produces HTML. It
 * returns plain character offsets that a `decorate` plugin turns into Slate
 * ranges; nested Prism tokens are emitted after their parent so the more
 * specific class wins on the rendered leaf.
 */

// Core only: `prismjs`' default entry preloads four grammars, and the popup
// pays for every grammar it ships. Load exactly the ones the picker exposes,
// using Prism's preminified components so the bundle does not pay twice.
import Prism from "prismjs/components/prism-core.min.js";

import "prismjs/components/prism-markup.min.js";
import "prismjs/components/prism-css.min.js";
import "prismjs/components/prism-clike.min.js";
import "prismjs/components/prism-javascript.min.js";
import "prismjs/components/prism-typescript.min.js";
import "prismjs/components/prism-jsx.min.js";
import "prismjs/components/prism-tsx.min.js";
import "prismjs/components/prism-json.min.js";
import "prismjs/components/prism-python.min.js";
import "prismjs/components/prism-bash.min.js";
import "prismjs/components/prism-sql.min.js";
import "prismjs/components/prism-markdown.min.js";
import "prismjs/components/prism-yaml.min.js";
import "prismjs/components/prism-java.min.js";
import "prismjs/components/prism-go.min.js";
import "prismjs/components/prism-rust.min.js";
import "prismjs/components/prism-c.min.js";
import "prismjs/components/prism-cpp.min.js";
import "prismjs/components/prism-csharp.min.js";

/** Languages offered by the code-block header picker. */
export const CODE_LANGUAGES = [
  { id: "", label: "Plain text" },
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "jsx", label: "JSX" },
  { id: "tsx", label: "TSX" },
  { id: "json", label: "JSON" },
  { id: "html", label: "HTML" },
  { id: "css", label: "CSS" },
  { id: "python", label: "Python" },
  { id: "bash", label: "Bash" },
  { id: "sql", label: "SQL" },
  { id: "markdown", label: "Markdown" },
  { id: "yaml", label: "YAML" },
  { id: "java", label: "Java" },
  { id: "go", label: "Go" },
  { id: "rust", label: "Rust" },
  { id: "c", label: "C" },
  { id: "cpp", label: "C++" },
  { id: "csharp", label: "C#" },
] as const;

export type CodeTokenClass =
  | "comment"
  | "string"
  | "keyword"
  | "number"
  | "function"
  | "operator"
  | "punctuation"
  | "regex"
  | "tag"
  | "property"
  | "variable"
  | "class";

export type CodeTokenRange = {
  start: number;
  end: number;
  token: CodeTokenClass;
};

type TokenNode = {
  type: string;
  content: string | TokenNode | Array<string | TokenNode>;
  alias?: string | string[];
};

/** Map fence info strings (and common aliases) to loaded Prism grammars. */
const GRAMMAR_BY_LANGUAGE: Record<string, string> = {
  "": "text",
  text: "text",
  js: "javascript",
  javascript: "javascript",
  ts: "typescript",
  typescript: "typescript",
  jsx: "jsx",
  tsx: "tsx",
  json: "json",
  html: "markup",
  xml: "markup",
  svg: "markup",
  markup: "markup",
  css: "css",
  py: "python",
  python: "python",
  sh: "bash",
  bash: "bash",
  shell: "bash",
  console: "bash",
  sql: "sql",
  md: "markdown",
  markdown: "markdown",
  yml: "yaml",
  yaml: "yaml",
  java: "java",
  go: "go",
  golang: "go",
  rs: "rust",
  rust: "rust",
  c: "c",
  h: "c",
  cpp: "cpp",
  "c++": "cpp",
  cs: "csharp",
  csharp: "csharp",
};

/** A small, fixed class vocabulary keeps arbitrary Prism types out of the DOM. */
const TOKEN_CLASS: Record<string, CodeTokenClass> = {
  comment: "comment",
  prolog: "comment",
  doctype: "comment",
  cdata: "comment",
  string: "string",
  char: "string",
  "attr-value": "string",
  keyword: "keyword",
  keyword2: "keyword",
  selector: "keyword",
  important: "keyword",
  atrule: "keyword",
  number: "number",
  boolean: "number",
  constant: "number",
  symbol: "number",
  function: "function",
  builtin: "function",
  operator: "operator",
  entity: "operator",
  punctuation: "punctuation",
  regex: "regex",
  tag: "tag",
  "attr-name": "property",
  property: "property",
  variable: "variable",
  parameter: "variable",
  "class-name": "class",
};

/** Resolve a fence info string to the class shown in the language picker. */
export function codeLanguageId(raw: string | undefined): string {
  const value = (raw ?? "").trim().toLowerCase();
  return CODE_LANGUAGES.some((language) => language.id === value) ? value : "";
}

/** Resolve a fence info string to a Prism grammar, or null for plain text. */
export function codeGrammar(raw: string | undefined): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  const grammar = GRAMMAR_BY_LANGUAGE[value];
  return grammar && grammar !== "text" ? grammar : null;
}

function tokenLength(token: TokenNode | string): number {
  if (typeof token === "string") return token.length;
  if (typeof token.content === "string") return token.content.length;
  if (Array.isArray(token.content)) {
    return token.content.reduce((sum, child) => sum + tokenLength(child), 0);
  }
  return tokenLength(token.content);
}

function tokenClass(token: TokenNode): CodeTokenClass | null {
  const aliases = Array.isArray(token.alias)
    ? token.alias
    : token.alias
      ? [token.alias]
      : [];
  for (const candidate of [token.type, ...aliases]) {
    const resolved = TOKEN_CLASS[candidate];
    if (resolved) return resolved;
  }
  return null;
}

/**
 * Tokenize code into absolute character ranges. Empty ranges are dropped, and
 * unknown token types are left unstyled rather than becoming arbitrary classes.
 */
export function highlightCodeRanges(
  text: string,
  language: string | undefined
): CodeTokenRange[] {
  const grammar = codeGrammar(language);
  if (!grammar || !text) return [];

  const grammarObject = Prism.languages[grammar];
  if (!grammarObject) return [];

  const tokens = Prism.tokenize(text, grammarObject) as Array<
    TokenNode | string
  >;
  const ranges: CodeTokenRange[] = [];
  let offset = 0;

  const consume = (content: TokenNode | string | Array<TokenNode | string>) => {
    if (typeof content === "string") {
      offset += content.length;
      return;
    }
    if (Array.isArray(content)) {
      for (const child of content) consume(child);
      return;
    }

    const start = offset;
    const length = tokenLength(content);
    const token = tokenClass(content);
    if (token && length > 0) {
      // Parent first: a nested interpolation or tag attribute overrides its
      // surrounding string/tag when Slate assigns leaf decorations in order.
      ranges.push({ start, end: start + length, token });
    }
    consume(content.content);
    offset = start + length;
  };

  for (const token of tokens) consume(token);
  return ranges;
}
