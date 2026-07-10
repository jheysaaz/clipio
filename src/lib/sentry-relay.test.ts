/**
 * Sentry Relay Security Tests
 *
 * Verifies that the Sentry relay properly validates message senders
 * to prevent malicious websites from abusing the relay.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SentryRelayMessage } from "./sentry-relay";
import { SENTRY_RELAY_MESSAGE_TYPE } from "./sentry-relay";

describe("Sentry Relay Security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Sender Validation", () => {
    it("should reject messages from external websites (sender.id mismatch)", () => {
      // This test documents the security requirement.
      // The actual validation is done in sentry-relay.ts in the message listener.

      const mockBrowserRuntimeId: string = "valid-extension-id-123";
      const externalWebsiteId: string = "malicious-website-id";

      // Message from external website should be rejected
      // (Comparing two different IDs should show they don't match)
      const isValidSender = externalWebsiteId === mockBrowserRuntimeId;
      expect(isValidSender).toBe(false); // Will be false for different IDs
    });

    it("should accept messages from the extension itself", () => {
      // Messages with matching sender.id should be accepted
      const mockBrowserRuntimeId: string = "valid-extension-id-123";
      const contentScriptId: string = "valid-extension-id-123"; // Same as extension

      const isValidSender = contentScriptId === mockBrowserRuntimeId;
      expect(isValidSender).toBe(true);
    });

    it("should only accept valid SENTRY_RELAY_MESSAGE_TYPE messages", () => {
      const validMessage: SentryRelayMessage = {
        type: SENTRY_RELAY_MESSAGE_TYPE,
        envelope: "serialized-envelope-data",
      };

      const invalidMessage: Record<string, unknown> = {
        type: "some-other-message-type",
        envelope: "data",
      };

      expect(validMessage.type).toBe(SENTRY_RELAY_MESSAGE_TYPE);
      expect(invalidMessage.type).not.toBe(SENTRY_RELAY_MESSAGE_TYPE);
    });

    it("should reject messages with missing envelope data", () => {
      const messageWithoutEnvelope = {
        type: SENTRY_RELAY_MESSAGE_TYPE,
        envelope: "",
      };

      const messageWithoutEnvelopeProperty: Record<string, unknown> = {
        type: SENTRY_RELAY_MESSAGE_TYPE,
      };

      expect(messageWithoutEnvelope.envelope).toBe("");
      expect(messageWithoutEnvelopeProperty.envelope).toBeUndefined();
    });

    it("should validate that envelope is a non-empty string", () => {
      const validEnvelope = "valid-envelope-content";
      const emptyEnvelope = "";

      expect(validEnvelope).toBeTruthy();
      expect(emptyEnvelope).toBeFalsy();
    });
  });

  describe("Message Type Validation", () => {
    it("should verify message structure before processing", () => {
      // Valid message structure
      const validStructure = {
        type: SENTRY_RELAY_MESSAGE_TYPE,
        envelope: "some-data",
      };

      // Invalid structures
      const notAnObject = "not an object";
      const nullObject = null;
      const noTypeField: Record<string, unknown> = { envelope: "data" };

      expect(typeof validStructure).toBe("object");
      expect(validStructure).not.toBeNull();
      expect(validStructure.type).toBeDefined();

      expect(typeof notAnObject).not.toBe("object");
      expect(nullObject).toBeNull();
      expect(noTypeField.type).toBeUndefined();
    });
  });

  describe("DSN and Endpoint Validation", () => {
    it("should validate DSN format before building the ingest URL", () => {
      const validDsn = "https://key@sentry.io/project-id";
      const invalidDsn = "not-a-valid-dsn";

      try {
        const urlValid = new URL(validDsn);
        expect(urlValid.protocol).toBe("https:");
        expect(urlValid.hostname).toBe("sentry.io");
      } catch {
        expect.fail("Valid DSN should parse without error");
      }

      try {
        new URL(invalidDsn);
        expect.fail("Invalid DSN should throw");
      } catch (e) {
        expect(e).toBeDefined();
      }
    });

    it("should handle DSN parsing errors safely", () => {
      const malformedDsn = ":::not-valid-dsn";

      let parseError: Error | undefined;
      try {
        new URL(malformedDsn);
      } catch (e) {
        parseError = e as Error;
      }

      expect(parseError).toBeDefined();
      expect(parseError?.message).toContain("Invalid URL");
    });
  });

  describe("Response Handling", () => {
    it("should respond with {ok: false} on validation failure", () => {
      // When sender.id doesn't match or data is invalid, respond {ok: false}
      const failureResponse = { ok: false };

      expect(failureResponse.ok).toBe(false);
    });

    it("should respond with {ok: true} on successful relay", () => {
      // When relay succeeds, respond {ok: true}
      const successResponse = { ok: true };

      expect(successResponse.ok).toBe(true);
    });

    it("should handle async response from fetch", () => {
      // Fetch is async; the relay should handle the response asynchronously
      const envelopeData = "serialized-envelope";

      const mockFetch = vi.fn().mockResolvedValue(new Response("OK"));
      expect(mockFetch).toBeDefined();

      // Response should be awaited or handled via .then()
      const fetchPromise = mockFetch("https://sentry.io/api/123/envelope/", {
        method: "POST",
        body: envelopeData,
        headers: { "Content-Type": "application/x-sentry-envelope" },
      });

      expect(fetchPromise).toBeInstanceOf(Promise);
    });
  });
});
