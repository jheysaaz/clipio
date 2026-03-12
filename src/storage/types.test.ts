/**
 * Tests for src/storage/types.ts — StorageQuotaError
 * spec: specs/storage.spec.md#StorageQuotaError
 */

import { describe, it, expect } from "vitest";
import { StorageQuotaError } from "./types";

describe("StorageQuotaError", () => {
  // spec: MUST extend Error
  it("is an instance of Error", () => {
    const err = new StorageQuotaError();
    expect(err).toBeInstanceOf(Error);
  });

  it("is an instance of StorageQuotaError", () => {
    const err = new StorageQuotaError();
    expect(err).toBeInstanceOf(StorageQuotaError);
  });

  // spec: MUST have name === "StorageQuotaError"
  it("has name StorageQuotaError", () => {
    const err = new StorageQuotaError();
    expect(err.name).toBe("StorageQuotaError");
  });

  // spec: MUST have a default message
  it("has a default message about quota exceeded", () => {
    const err = new StorageQuotaError();
    expect(err.message).toBe("browser.storage.sync quota exceeded");
  });

  // spec: MUST accept a custom message
  it("accepts a custom message", () => {
    const err = new StorageQuotaError("Custom quota error message");
    expect(err.message).toBe("Custom quota error message");
  });

  // Ensures it can be caught and identified by type
  it("can be caught and identified as StorageQuotaError", () => {
    const thrower = () => {
      throw new StorageQuotaError();
    };
    expect(() => thrower()).toThrow(StorageQuotaError);
    expect(() => thrower()).toThrow("browser.storage.sync quota exceeded");
  });
});
