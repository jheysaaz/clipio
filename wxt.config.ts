import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";

/**
 * Splits heavy vendor libraries into separate chunks for HTML entrypoints
 * (popup, options). Skips IIFE builds (background, content scripts) because
 * those use `inlineDynamicImports: true` which is incompatible with manualChunks.
 */
function vendorChunksPlugin(): Plugin {
  return {
    name: "vendor-chunks",
    apply: "build",
    outputOptions(opts) {
      if (opts.inlineDynamicImports) return;
      opts.manualChunks = (id: string) => {
        if (
          id.includes("node_modules/react/") ||
          id.includes("node_modules/react-dom/") ||
          id.includes("node_modules/scheduler/")
        ) {
          return "vendor-react";
        }
        if (
          id.includes("node_modules/platejs/") ||
          id.includes("node_modules/@platejs/") ||
          id.includes("node_modules/slate/") ||
          id.includes("node_modules/slate-react/") ||
          id.includes("node_modules/slate-dom/") ||
          id.includes("node_modules/slate-history/") ||
          id.includes("node_modules/slate-hyperscript/")
        ) {
          return "vendor-editor";
        }
        if (id.includes("node_modules/@radix-ui/")) {
          return "vendor-radix";
        }
        if (id.includes("node_modules/lucide-react/")) {
          return "vendor-icons";
        }
      };
      return opts;
    },
  };
}

// https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react", "@wxt-dev/i18n/module"],
  srcDir: "src",
  manifest: {
    name: "__MSG_extName__",
    description: "__MSG_extDescription__",
    default_locale: "en",
    permissions: ["storage", "clipboardWrite", "clipboardRead"],
    browser_specific_settings: {
      gecko: {
        id: "jhey@clipio.xyz",
        strict_min_version: "142.0",
      },
    },
  },
  vite: () => ({
    plugins: [tailwindcss(), vendorChunksPlugin()],
  }),
});
