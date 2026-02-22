import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

// https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  srcDir: "src",
  manifest: {
    name: "Clipio: Snippets Manager",
    description:
      "A powerful browser extension for managing and inserting snippets with lightning speed and increase your productivity.",
    permissions: ["storage", "clipboardWrite", "clipboardRead"],
    browser_specific_settings: {
      gecko: {
        id: "jhey@clipio.xyz",
        strict_min_version: "142.0",
      },
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
