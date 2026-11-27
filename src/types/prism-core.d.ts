/**
 * Prism publishes its core as a CommonJS component without its own types.
 * The public `prismjs` types describe the same object, so re-export them for
 * the core-only import used by the code highlighter.
 */
declare module "prismjs/components/prism-core.min.js" {
  import Prism from "prismjs";

  export default Prism;
}
