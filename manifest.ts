import { defineManifest } from "@crxjs/vite-plugin";
import packageInfo from "./package.json" assert { type: "json" };

export default defineManifest({
  manifest_version: 3,
  name: packageInfo.displayName || packageInfo.name,
  description: packageInfo.description,
  version: packageInfo.version,
  icons: {
    "16": "icon/16.png",
    "32": "icon/32.png",
    "48": "icon/48.png",
    "96": "icon/96.png",
    "128": "icon/128.png",
  },
  action: {
    default_popup: "src/popup.html",
  },
  background: {
    service_worker: "src/background.ts",
  },
  permissions: [
    "storage",
    "alarms",
    "clipboardWrite",
    "http://snippy.jheysonsaavedra.com/*",
  ],
  host_permissions: ["http://snippy.jheysonsaavedra.com/*"],
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content.ts"],
      run_at: "document_idle",
    },
  ],
});
