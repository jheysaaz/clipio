import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import fs from "node:fs/promises";
import path from "node:path";

const sentryEnabled = !!process.env.SENTRY_AUTH_TOKEN;

// https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react", "@wxt-dev/i18n/module"],
  srcDir: "src",
  // Source maps and the Sentry plugin are only active when SENTRY_AUTH_TOKEN is
  // present (i.e. CI / production builds). Without the token, no .map files are
  // produced so WXT's printBuildSummary never tries to lstat them.
  //
  // When Sentry IS active, its writeBundle hook uploads maps and then its
  // deleteArtifacts() is a no-op (filesToDeleteAfterUpload not set). But WXT's
  // printBuildSummary still calls fs.lstat on every .map chunk entry. We touch
  // stub files in build:done so lstat succeeds, then delete them immediately
  // after via setImmediate (one event-loop turn after the Promise.all resolves).
  hooks: {
    "build:done": async (wxt, output) => {
      if (!sentryEnabled) return;
      const outDir = wxt.config.outDir;
      // Collect all .map filenames from the build output
      const mapFiles = output.steps
        .flatMap((step) => step.chunks)
        .filter((chunk) => chunk.fileName.endsWith(".map"))
        .map((chunk) => path.join(outDir, chunk.fileName));
      if (mapFiles.length === 0) return;
      // Touch stub files so printBuildSummary's fs.lstat calls succeed
      await Promise.all(
        mapFiles.map((f) =>
          fs
            .mkdir(path.dirname(f), { recursive: true })
            .then(() => fs.writeFile(f, ""))
            .catch(() => {})
        )
      );
      // Schedule deletion AFTER printBuildSummary finishes. printBuildSummary
      // uses Promise.all over all files, so a single event-loop turn is enough.
      setImmediate(() => {
        Promise.all(
          mapFiles.map((f) => fs.rm(f, { force: true }).catch(() => {}))
        );
      });
    },
  },
  manifest: {
    name: "__MSG_extName__",
    description: "__MSG_extDescription__",
    default_locale: "en",
    permissions: [
      "storage",
      "clipboardWrite",
      "clipboardRead",
      "contextMenus",
      "alarms",
      "notifications",
      "tabs",
    ],
    // Allow all extension contexts (including content scripts) to reach Sentry.
    // The DSN uses the US ingest cluster (*.ingest.us.sentry.io); keeping the
    // broader *.ingest.sentry.io as well covers EU tenants and future regions.
    host_permissions: [
      "https://*.ingest.us.sentry.io/*",
      "https://*.ingest.sentry.io/*",
      "https://api.giphy.com/*",
      "https://api.github.com/*",
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
      // Only include the Sentry plugin when the auth token is present.
      // The plugin's renderChunk hook injects a debug-ID snippet that forces
      // Rollup to generate .map files even when build.sourcemap is false, so we
      // must not register it at all in dev / no-token builds.
      ...(sentryEnabled
        ? [
            sentryVitePlugin({
              org: process.env.SENTRY_ORG,
              project: process.env.SENTRY_PROJECT,
              authToken: process.env.SENTRY_AUTH_TOKEN,
              release: {
                // Use the manifest version (or explicit env var) as the Sentry
                // release name so it matches the value set in BrowserClient at
                // runtime. Fall back to "dev" so the CLI never receives an
                // empty release name.
                name: process.env.WXT_SENTRY_RELEASE || "dev",
              },
              sourcemaps: {
                // Do NOT use filesToDeleteAfterUpload here — Sentry's
                // writeBundle finally{} would delete .map files before WXT's
                // printBuildSummary finishes reading them (ENOENT crash). The
                // build:done hook above handles deletion instead.
              },
              telemetry: false,
            }),
          ]
        : []),
    ],
    build: {
      // Only emit source maps when Sentry will upload them (auth token present).
      // Without the token sourcemap: false means no .map files are produced at
      // all, so WXT's printBuildSummary never tries to lstat them.
      sourcemap: sentryEnabled ? "hidden" : false,
      // Slate/Plate and Radix have internal circular dependencies that break
      // when forced into manual chunks. Let Rollup split automatically —
      // it resolves init order correctly. The popup chunk (~512KB) is still
      // well within extension store limits.
      chunkSizeWarningLimit: 600,
    },
  }),
});
