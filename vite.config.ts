import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest";
import zip from "vite-plugin-zip-pack";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    crx({
      manifest,
    }),
    zip({ outDir: "release", outFileName: "Snippy.zip" }),
  ],
  server: {
    cors: {
      origin: [/chrome-extension:\/\//],
    },
  },
  build: {
    sourcemap: false,
    minify: "esbuild",
  },
});
