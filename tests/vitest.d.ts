/**
 * Type wiring for the test environment.
 *
 * `@testing-library/jest-dom` adds matchers like `toBeInTheDocument` at runtime
 * via the import in tests/setup.ts, but tsc only sees them if the types are
 * pulled into the program. Importing the vitest entrypoint here is what makes
 * `pnpm compile` accept those matchers.
 */
import "@testing-library/jest-dom/vitest";
