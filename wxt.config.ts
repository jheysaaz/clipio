import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";

// https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react", "@wxt-dev/i18n/module"],
  srcDir: "src",
  manifest: {
    name: "__MSG_extName__",
    description: "__MSG_extDescription__",
    default_locale: "en",
    permissions: ["storage", "clipboardWrite", "clipboardRead", "contextMenus"],
    // Allow all extension contexts (including content scripts) to reach Sentry.
    // The DSN uses the US ingest cluster (*.ingest.us.sentry.io); keeping the
    // broader *.ingest.sentry.io as well covers EU tenants and future regions.
    host_permissions: [
      "https://*.ingest.us.sentry.io/*",
      "https://*.ingest.sentry.io/*",
    ],
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
    plugins: [
      tailwindcss(),
      // Upload source maps to Sentry on production builds.
      // Requires SENTRY_AUTH_TOKEN, SENTRY_ORG, and SENTRY_PROJECT env vars.
      // Source map files are deleted after upload so they are never shipped
      // inside the extension package.
      sentryVitePlugin({
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
        sourcemaps: {
          filesToDeleteAfterUpload: [".output/**/*.map"],
        },
        // Only run when the auth token is present (i.e. CI / production builds)
        disable: !process.env.SENTRY_AUTH_TOKEN,
        telemetry: false,
      }),
    ],
    build: {
      // Emit source maps for Sentry (deleted after upload in prod, omitted in dev)
      sourcemap: true,
      // Slate/Plate and Radix have internal circular dependencies that break
      // when forced into manual chunks. Let Rollup split automatically —
      // it resolves init order correctly. The popup chunk (~512KB) is still
      // well within extension store limits.
      chunkSizeWarningLimit: 600,
    },
  }),
});
