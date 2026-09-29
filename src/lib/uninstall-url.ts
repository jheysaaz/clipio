/**
 * The URL Chrome opens when the user removes the extension.
 *
 * Its own module, not a helper inside `background.ts`, for two reasons:
 *
 * 1. Importing `background.ts` from a unit test executes every listener
 *    registration in the service worker, so a test could not reach this function
 *    without side effects.
 * 2. The `onInstalled` handler that calls it fires exactly once, at install,
 *    and Chrome exposes no `getUninstallURL` to read the result back. The
 *    previous e2e test therefore called `runtime.setUninstallURL` *itself* and
 *    asserted that its own call did not throw — which passes whether or not the
 *    product ever sets anything, and flaked when the service worker was not yet
 *    ready to accept the call.
 *
 * What is actually worth testing here is the URL construction, and that is
 * testable now.
 */

import { ONBOARDING_SUPPORTED_LOCALES } from "@/config/constants";

export function buildUninstallUrl(
  websiteUrl: string,
  rawLocale: string
): string {
  const locale = (ONBOARDING_SUPPORTED_LOCALES as readonly string[]).includes(
    rawLocale
  )
    ? rawLocale
    : "en";
  return `${websiteUrl}/${locale}/uninstall`;
}
