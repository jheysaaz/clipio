import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import webExtension, { readJsonFile } from "vite-plugin-web-extension";
import tailwindcss from "@tailwindcss/vite";

function generateManifest() {
  const manifest = readJsonFile("src/manifest.json");
  const pkg = readJsonFile("package.json");
  
  // Remove beta/alpha/rc suffixes from version for Chrome Web Store compatibility
  const sanitizedVersion = pkg.version.replace(/-.*$/, "");
  
  return {
    name: pkg.displayName || pkg.name,
    description: pkg.description,
    version: sanitizedVersion,
    ...manifest,
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    webExtension({
      manifest: generateManifest,
    }),
  ],
  build: {
    sourcemap: false,
    minify: "esbuild"
  }
});
