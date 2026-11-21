# Clipio

A browser extension for managing and inserting text snippets with speed and precision.

Built with [WXT](https://wxt.dev), React 19, and Tailwind CSS v4. Available for Chrome and Firefox.

## Requirements

- [Node.js](https://nodejs.org) 26+
- [pnpm](https://pnpm.io) 10+

## Development

Install dependencies:

```sh
pnpm install
```

Start the development server (Chrome):

```sh
pnpm dev
```

Start the development server (Firefox):

```sh
pnpm dev:firefox
```

WXT will open the browser automatically with the extension loaded and hot-reload on file changes.

Copy `.env.example` to `.env` and fill in any values you need for local development (Sentry is optional and disabled when the DSN is blank):

```sh
cp .env.example .env
```

Set `WXT_GIPHY_API_KEY` in `.env` if you want a project-wide default Giphy key. Users can still override it from Options > Developers.

## Building for Production

Build the unpacked extension:

```sh
# Chrome (MV3)
pnpm build

# Firefox
pnpm build:firefox
```

Build and package as a ZIP ready for store submission:

```sh
# Chrome
pnpm zip

# Firefox (produces both the extension ZIP and a sources ZIP required by Mozilla)
pnpm zip:firefox
```

Output files are placed in `.output/`.

## Testing

### Unit Tests

Run once:

```sh
pnpm test
```

Run with coverage report (enforces per-module thresholds defined in `vitest.config.ts`):

```sh
pnpm test:coverage
```

Run in watch mode:

```sh
pnpm test:watch
```

Unit tests live alongside source files as `*.test.ts` and use [Vitest](https://vitest.dev) with a `happy-dom` environment. Global browser API mocks are set up in `tests/setup.ts`.

### E2E Tests

E2E tests run against a real Chromium instance with the built extension loaded. Build the extension first, then run the tests:

```sh
pnpm build
pnpm test:e2e
```

Or skip the manual build step by letting the global setup handle it:

```sh
pnpm test:e2e
```

To run in headed mode (watch the browser):

```sh
pnpm test:e2e:headed
```

To open the Playwright UI:

```sh
pnpm test:e2e:ui
```

E2E tests are in the `e2e/` directory and use [Playwright](https://playwright.dev). The test server for content script injection runs on `http://localhost:7777`.

### Type Check

```sh
pnpm compile
```

### Format Check

```sh
pnpm format:check
```

Auto-format:

```sh
pnpm format
```

## CI/CD

### CI Workflow (`ci.yml`)

Runs on every push to `main` and on every pull request targeting `main`.

Jobs run in this order:

```
format-check
     |
     +---> unit-tests
     |
     +---> e2e-tests
                |
                +--- (both feed into)
                |
           build-validation
```

| Job                | What it does                                                                |
| ------------------ | --------------------------------------------------------------------------- |
| `format-check`     | Prettier format check                                                       |
| `unit-tests`       | Type check + unit tests with coverage + Codecov upload                      |
| `e2e-tests`        | Build Chrome extension + Playwright E2E tests                               |
| `build-validation` | Produces Chrome and Firefox ZIPs; uploads as artifacts with 3-day retention |

### Publish Workflow (`publish.yml`)

Triggered automatically on a version tag push matching `v<major>.<minor>.<patch>` (e.g., `v1.4.0`), or manually from the Actions tab.

When triggered manually via `workflow_dispatch`, a **Dry Run** option is available. Enabling it validates credentials and ZIPs against the store APIs without submitting anything.

Chrome and Firefox are checked independently. A store with a complete credential set is submitted; a store with missing secrets is skipped with a notice. Missing credentials for one store never block the other store or the GitHub Release.

Jobs run in this order:

```
format-check
     |
     +---> unit-tests
     |
     +---> e2e-tests
                |
                +--- (both feed into)
                |
              zip
               |
        +------+------+
        |             |
     submit     github-release
```

| Job              | What it does                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `format-check`   | Prettier format check                                                                           |
| `unit-tests`     | Type check + unit tests                                                                         |
| `e2e-tests`      | Build + Playwright E2E tests                                                                    |
| `zip`            | Builds production ZIPs for Chrome and Firefox (with Sentry source maps)                         |
| `submit`         | Submits each available store independently via `wxt submit`; skips one with missing credentials |
| `github-release` | Creates a GitHub Release with auto-generated notes and ZIPs attached (tag push only)            |

## Publishing

### First-Time Setup

Before the publish workflow can run, you need to configure API credentials in your repository's **Settings > Secrets and variables > Actions**.

`wxt submit` is an alias for `publish-extension` v6. Run its setup locally to walk through each store and generate all required values:

```sh
pnpm wxt submit init
```

It writes a `.env.submit` file (gitignored). Use the same values as repository secrets; the workflow passes them to the CLI as environment variables. The CLI also has `pnpm wxt submit status` for checking review state.

### Required GitHub Secrets

#### Chrome Web Store (v2 API)

`publish-extension` v5 moved Chrome to the v2 API, which authenticates with a **service account** instead of an OAuth refresh token. The old `CHROME_CLIENT_ID` / `CHROME_CLIENT_SECRET` / `CHROME_REFRESH_TOKEN` secrets are deprecated and stopped working on 2026-10-15; the workflow no longer reads them.

| Secret                                | Description                                 | Where to get it                                                                 |
| ------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------- |
| `CHROME_EXTENSION_ID`                 | Your extension's ID on the Chrome Web Store | Chrome Web Store Developer Dashboard > your extension URL                       |
| `CHROME_PUBLISHER_ID`                 | Publisher ID that owns the extension        | Dev console URL: `https://chrome.google.com/webstore/devconsole/<publisher-id>` |
| `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL` | Service account email                       | `client_email` in the service account's JSON key                                |
| `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY`  | Service account private key                 | `private_key` in the JSON key — store real line breaks, not escaped `\n`        |

The workflow sets `CHROME_API_VERSION=v2` for both submit modes. To create the service account and grant it access, follow Google's [Chrome Web Store service-account guide](https://developer.chrome.com/docs/webstore/service-accounts).

Optional v2 controls are forwarded when set: `CHROME_SKIP_SUBMIT_REVIEW` (upload without sending for review), `CHROME_PUBLISH_TYPE`, `CHROME_DEPLOY_PERCENTAGE`, `CHROME_CANCEL_PENDING` and `CHROME_SKIP_REVIEW`. Unset ones are omitted rather than passed as empty strings, which the CLI rejects.

#### Firefox Addon Store

| Secret                 | Description                             | Where to get it                                                                                           |
| ---------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `FIREFOX_EXTENSION_ID` | Your add-on ID (e.g. `jhey@clipio.xyz`) | Firefox Developer Hub > your extension listing                                                            |
| `FIREFOX_JWT_ISSUER`   | API key (JWT issuer)                    | [addons.mozilla.org/developers/addon/api/key](https://addons.mozilla.org/en-US/developers/addon/api/key/) |
| `FIREFOX_JWT_SECRET`   | API secret (JWT secret)                 | Same page as JWT issuer                                                                                   |

Each store is gated on its own credential set. With only the Chrome secrets, Chrome is submitted and Firefox is skipped with a notice; with only the Firefox secrets, the reverse. With neither, both are skipped and the GitHub Release is still created with all three ZIPs attached.

#### Sentry (optional, for source map upload during production builds)

| Secret              | Description                                   | Where to get it                                              |
| ------------------- | --------------------------------------------- | ------------------------------------------------------------ |
| `SENTRY_AUTH_TOKEN` | User auth token with `project:releases` scope | Sentry > Settings > Auth Tokens                              |
| `SENTRY_ORG`        | Organization slug                             | Visible in your Sentry URL: `sentry.io/organizations/<slug>` |
| `SENTRY_PROJECT`    | Project slug                                  | Visible in your Sentry project URL                           |
| `WXT_SENTRY_DSN`    | Sentry DSN embedded in the extension          | Sentry > your project > Client Keys                          |

#### Other

| Secret          | Description                                       |
| --------------- | ------------------------------------------------- |
| `CODECOV_TOKEN` | Codecov upload token (for coverage reports in CI) |

### Publishing a New Version

1. Bump `version` in `package.json` — WXT derives both manifests from it; `wxt.config.ts` has no separate version.
2. Commit and push the version bump.
3. Tag the commit with the new version:
   ```sh
   git tag v1.7.0
   git push origin v1.7.0
   ```
4. The publish workflow triggers automatically, runs all tests, builds the ZIPs, submits to whichever stores have complete credentials, and creates a GitHub Release with all three ZIPs attached.

To do a dry run first (recommended when setting up for the first time):

1. Go to **Actions > Publish > Run workflow**.
2. Check the **Dry Run** checkbox.
3. Click **Run workflow**.

## Documentation

| Where                                            | What                                                          |
| ------------------------------------------------ | ------------------------------------------------------------- |
| [`AGENTS.md`](./AGENTS.md)                       | How to work on this codebase — commands, rules, boundaries    |
| [`docs/architecture.md`](./docs/architecture.md) | How it is put together                                        |
| [`docs/decisions/`](./docs/decisions/)           | Decisions and the reasoning behind them                       |
| [`docs/open.md`](./docs/open.md)                 | Known gaps. A state, not a log — items are deleted when fixed |

Module behaviour is specified by its tests, not by a parallel prose document. A
test can fail; a paragraph describing it cannot. When the _reason_ behind a choice
matters — why something was rejected, what would justify revisiting it — that
goes in `docs/decisions/`, where it does not rot against the code.

## License

MIT License. Copyright (c) 2025-2026 Jheyson Saavedra. See [LICENSE](LICENSE) for the full text.
