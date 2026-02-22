# Privacy Policy

Last updated: February 22, 2026

Clipio ("we", "us", or "our") is a browser extension available for Chrome and Firefox (the "Extension"). This Privacy Policy explains how we handle your information when you use Clipio.

By installing or using the Extension, you agree to this Privacy Policy.

---

## 1. Information We Collect

### a. Snippet Data (stored locally on your device)

All snippets you create — including their shortcut, label, content, and tags — are stored exclusively on your device using the browser's built-in `storage.sync` and `storage.local` APIs. Snippet data may be synced across your own devices by the browser's native sync infrastructure (e.g., Chrome Sync or Firefox Sync) if you are signed in to your browser; this sync is performed directly by the browser and is outside Clipio's control.

We never transmit your snippet content to our servers.

### b. Error and Diagnostic Data

To detect and fix bugs we collect anonymized error reports through Sentry (see Section 4). Error reports may include:

- Error type and error message
- Stack trace (file and line number references within the extension's own code)
- The extension context where the error occurred (background, popup, options, or content script)
- The operation that triggered the error (e.g., `loadSnippets`, `exportSnippets`)
- Snippet shortcut text and snippet label (e.g., `;gr` or "Greeting template")
- Storage mode (`sync` or `local`)
- Extension version and release identifier

**The following data is never included in error reports:**

- Snippet body content
- Clipboard contents
- The URLs of pages you visit in your browser

---

## 2. How We Use Your Information

We use diagnostic data solely to:

- Detect and fix bugs and technical errors in the Extension
- Improve performance and reliability
- Detect technical issues that could affect users

We do not use your data for advertising, profiling, or any purpose other than maintaining a functional, reliable extension.

---

## 3. Data Storage

All snippet data is stored locally on your device. Clipio does not operate a backend server that receives or stores your snippets. The Extension also maintains a local IndexedDB backup of your snippets on your device as a recovery mechanism in case of accidental data loss.

---

## 4. Third-Party Services

We use **Sentry** ([sentry.io](https://sentry.io)) exclusively for error monitoring in the Extension. No other third-party analytics or tracking service is used.

| Service | Purpose                          | Privacy Policy                                 |
| ------- | -------------------------------- | ---------------------------------------------- |
| Sentry  | Error monitoring and diagnostics | [sentry.io/privacy](https://sentry.io/privacy) |

Sentry is a U.S.-based company that complies with GDPR through Standard Contractual Clauses (SCCs) and offers a Data Processing Agreement (DPA). Data sent to Sentry is limited to the diagnostic fields listed in Section 1b. Error reports are retained for **90 days** and then automatically deleted.

You may opt out of error telemetry at any time by uninstalling the Extension.

---

## 5. Legal Bases for Processing (GDPR)

If you are in the European Economic Area (EEA), our legal basis for processing diagnostic error data is **legitimate interest** — detecting and fixing software defects to maintain a reliable and secure extension for all users.

No other personal data is processed by Clipio.

---

## 6. Your Rights

### European Union (GDPR)

You have the right to access, correct, delete, restrict, or port your data, and to withdraw consent at any time.

### United States (CCPA)

You may request:

- Information about data collected
- Deletion of your personal data
- Confirmation that your data is not sold

We do not sell personal data.

### Colombia (Ley 1581 de 2012 – Habeas Data)

You have the right to:

- Know, update, and correct your personal data
- Request proof of authorization
- Request deletion or revocation of consent
- File complaints with the Superintendencia de Industria y Comercio (SIC)

To exercise any of these rights, contact us at: [privacy@clipio.xyz](mailto:privacy@clipio.xyz)

---

## 7. Data Security

All snippet data remains on your device and is never transmitted to Clipio servers. For error reports sent to Sentry, we automatically strip all snippet body content and clipboard data before transmission. We apply reasonable technical measures to protect the diagnostic data that is collected.

---

## 8. Children's Privacy

The Extension is not intended for users under the age of 13. We do not knowingly collect personal data from children.

---

## 9. Changes to This Policy

We may update this Privacy Policy occasionally. Changes will be posted on this page with an updated effective date. Continued use of the Extension after changes constitutes acceptance of the updated policy.

---

## 10. Contact

For any questions or requests regarding privacy:
[privacy@clipio.xyz](mailto:privacy@clipio.xyz)
