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
    permissions: ["storage", "alarms", "clipboardWrite", "clipboardRead"],
    host_permissions: ["http://prod.clipio.xyz/*", "https://prod.clipio.xyz/*"],
    browser_specific_settings: {
      gecko: {
        id: "clipio@clipio.xyz",
        strict_min_version: "142.0",
      },
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
