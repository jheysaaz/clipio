# Clipio

A browser extension for managing and inserting text snippets with speed and precision.

Built with [WXT](https://wxt.dev), React 19, and Tailwind CSS v4. Available for Chrome and Firefox.

## Requirements

- [Node.js](https://nodejs.org) 24+
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

| Job              | What it does                                                                         |
| ---------------- | ------------------------------------------------------------------------------------ |
| `format-check`   | Prettier format check                                                                |
| `unit-tests`     | Type check + unit tests                                                              |
| `e2e-tests`      | Build + Playwright E2E tests                                                         |
| `zip`            | Builds production ZIPs for Chrome and Firefox (with Sentry source maps)              |
| `submit`         | Submits to Chrome Web Store and Firefox Addon Store via `wxt submit`                 |
| `github-release` | Creates a GitHub Release with auto-generated notes and ZIPs attached (tag push only) |

## Publishing

### First-Time Setup

Before the publish workflow can run, you need to configure API credentials in your repository's **Settings > Secrets and variables > Actions**.

Run `wxt submit init` locally to walk through the OAuth flow and generate all required values:

```sh
pnpm wxt submit init
```

### Required GitHub Secrets

#### Chrome Web Store

| Secret                 | Description                                 | Where to get it                                           |
| ---------------------- | ------------------------------------------- | --------------------------------------------------------- |
| `CHROME_EXTENSION_ID`  | Your extension's ID on the Chrome Web Store | Chrome Web Store Developer Dashboard > your extension URL |
| `CHROME_CLIENT_ID`     | OAuth2 client ID                            | Google Cloud Console > APIs & Services > Credentials      |
| `CHROME_CLIENT_SECRET` | OAuth2 client secret                        | Google Cloud Console > APIs & Services > Credentials      |
| `CHROME_REFRESH_TOKEN` | OAuth2 refresh token                        | Generated by `wxt submit init` via the OAuth flow         |

#### Firefox Addon Store

| Secret                 | Description                             | Where to get it                                                                                           |
| ---------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `FIREFOX_EXTENSION_ID` | Your add-on ID (e.g. `jhey@clipio.xyz`) | Firefox Developer Hub > your extension listing                                                            |
| `FIREFOX_JWT_ISSUER`   | API key (JWT issuer)                    | [addons.mozilla.org/developers/addon/api/key](https://addons.mozilla.org/en-US/developers/addon/api/key/) |
| `FIREFOX_JWT_SECRET`   | API secret (JWT secret)                 | Same page as JWT issuer                                                                                   |

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

1. Bump the version in `package.json` and `wxt.config.ts` (if the manifest version is separate).
2. Commit and push the version bump.
3. Tag the commit with the new version:
   ```sh
   git tag v1.4.0
   git push origin v1.4.0
   ```
4. The publish workflow triggers automatically, runs all tests, builds the ZIPs, submits to both stores, and creates a GitHub Release.

To do a dry run first (recommended when setting up for the first time):

1. Go to **Actions > Publish > Run workflow**.
2. Check the **Dry Run** checkbox.
3. Click **Run workflow**.

## Specifications

Behavioral specifications for every tested module live in `specs/`. Each spec file describes what a module must do, independent of implementation details.

Specs follow a Spec-Driven Development (SDD) + TDD workflow:

1. Write or update `specs/<module>.spec.md` describing the required behavior.
2. Write failing tests that encode every `MUST` clause from the spec.
3. Implement until all tests pass.
4. PRs must include: spec update + tests + implementation.

See [`specs/README.md`](specs/README.md) for the full directory index and conventions.

## License

MIT License. Copyright (c) 2025-2026 Jheyson Saavedra. See [LICENSE](LICENSE) for the full text.
