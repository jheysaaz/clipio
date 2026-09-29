/**
 * spec: src/lib/uninstall-url.ts
 *
 * Replaces an e2e test that could not fail: it called
 * `runtime.setUninstallURL` itself and asserted its own call did not throw. The
 * `onInstalled` handler that sets the real URL fires once at install, and Chrome
 * has no `getUninstallURL` to read it back, so the URL construction is the only
 * part worth pinning — and it is pinned here.
 */

import { describe, it, expect } from "vitest";
import { buildUninstallUrl } from "./uninstall-url";
import { ONBOARDING_SUPPORTED_LOCALES } from "@/config/constants";

describe("buildUninstallUrl", () => {
  it("builds the URL for a supported locale", () => {
    expect(buildUninstallUrl("https://clipio.xyz", "en")).toBe(
      "https://clipio.xyz/en/uninstall"
    );
    expect(buildUninstallUrl("https://clipio.xyz", "es")).toBe(
      "https://clipio.xyz/es/uninstall"
    );
  });

  it("falls back to en for an unsupported locale", () => {
    // `getUILanguage()` returns a full tag like "es-MX" or "fr", not necessarily
    // one of the supported set, so the fallback is the common path, not an edge
    // case.
    for (const locale of ["fr", "de", "pt-BR", "en-GB", ""]) {
      expect(buildUninstallUrl("https://clipio.xyz", locale)).toBe(
        "https://clipio.xyz/en/uninstall"
      );
    }
  });

  it("keeps the exact locale tag when it is supported", () => {
    for (const locale of ONBOARDING_SUPPORTED_LOCALES) {
      expect(buildUninstallUrl("https://x.dev", locale)).toBe(
        `https://x.dev/${locale}/uninstall`
      );
    }
  });

  it("preserves the website origin including a path prefix", () => {
    expect(buildUninstallUrl("https://example.com/clipio", "es")).toBe(
      "https://example.com/clipio/es/uninstall"
    );
  });

  it("does not treat a locale that merely starts with a supported one as supported", () => {
    // "en-GB" must not match "en" by prefix.
    expect(buildUninstallUrl("https://x.dev", "en-GB")).toBe(
      "https://x.dev/en/uninstall"
    );
  });
});
