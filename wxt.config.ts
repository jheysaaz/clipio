import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

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
        data_collection_permissions: {
          required: ["none"],
        },
      } as Record<string, unknown>,
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
    build: {
      // Slate/Plate and Radix have internal circular dependencies that break
      // when forced into manual chunks. Let Rollup split automatically —
      // it resolves init order correctly. The popup chunk (~512KB) is still
      // well within extension store limits.
      chunkSizeWarningLimit: 600,
    },
  }),
});
