/**
 * Sentry Relay Security Tests
 *
 * spec: none (security hardening — see src/lib/sentry-relay.ts)
 *
 * Invokes the REAL registerSentryRelayListener() (bypassing the global
 * ~/lib/sentry-relay mock from tests/setup.ts via vi.importActual) and
 * drives the captured onMessage listener with hostile and valid messages.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockRuntime } from "../../tests/mocks/browser";

type Listener = (
  message: unknown,
  sender: { id?: string },
  sendResponse: (response: unknown) => void
) => unknown;

async function loadActualRelay() {
  return await vi.importActual<typeof import("./sentry-relay")>(
    "./sentry-relay"
  );
}

async function registerAndGetListener(): Promise<{
  listener: Listener;
  relay: typeof import("./sentry-relay");
}> {
  const relay = await loadActualRelay();
  mockRuntime.onMessage.addListener.mockClear();
  relay.registerSentryRelayListener();
  const listener = mockRuntime.onMessage.addListener.mock
    .calls[0][0] as Listener;
  expect(listener).toBeTypeOf("function");
  return { listener, relay };
}

const EXT_ID = mockRuntime.id; // "test-extension-id"
const VALID_ENVELOPE = '{"event_id":"abc","sent_at":"2026-01-01T00:00:00Z"}';
const VALID_DSN = "https://abc123@sentry.io/42";

describe("Sentry Relay Security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("WXT_SENTRY_DSN", VALID_DSN);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe("Message type validation", () => {
    it("ignores messages that are not sentry-relay type (returns false, no response)", async () => {
      const { listener } = await registerAndGetListener();
      const sendResponse = vi.fn();

      const result = listener(
        { type: "some-other-message-type", envelope: "data" },
        { id: EXT_ID },
        sendResponse
      );

      expect(result).toBe(false);
      expect(sendResponse).not.toHaveBeenCalled();
    });

    it("ignores non-object messages (returns false, no response)", async () => {
      const { listener } = await registerAndGetListener();
      const sendResponse = vi.fn();

      expect(listener("not an object", { id: EXT_ID }, sendResponse)).toBe(
        false
      );
      expect(listener(null, { id: EXT_ID }, sendResponse)).toBe(false);
      expect(listener(undefined, { id: EXT_ID }, sendResponse)).toBe(false);
      expect(sendResponse).not.toHaveBeenCalled();
    });

    it("ignores messages missing the type field", async () => {
      const { listener } = await registerAndGetListener();
      const sendResponse = vi.fn();

      const result = listener(
        { envelope: VALID_ENVELOPE },
        { id: EXT_ID },
        sendResponse
      );

      expect(result).toBe(false);
      expect(sendResponse).not.toHaveBeenCalled();
    });
  });

  describe("Sender validation (external websites must be rejected)", () => {
    it("rejects a matching type from a foreign sender.id with {ok:false}", async () => {
      const { listener, relay } = await registerAndGetListener();
      const sendResponse = vi.fn();

      const result = listener(
        { type: relay.SENTRY_RELAY_MESSAGE_TYPE, envelope: VALID_ENVELOPE },
        { id: "malicious-website-id" },
        sendResponse
      );

      expect(result).toBe(false);
      expect(sendResponse).toHaveBeenCalledWith({ ok: false });
    });

    it("rejects a sender with no id (content script vs page ambiguity)", async () => {
      const { listener, relay } = await registerAndGetListener();
      const sendResponse = vi.fn();

      const result = listener(
        { type: relay.SENTRY_RELAY_MESSAGE_TYPE, envelope: VALID_ENVELOPE },
        {},
        sendResponse
      );

      expect(result).toBe(false);
      expect(sendResponse).toHaveBeenCalledWith({ ok: false });
    });

    it("accepts the extension's own sender.id (proceeds past sender check)", async () => {
      const { listener, relay } = await registerAndGetListener();
      const sendResponse = vi.fn();

      const result = listener(
        { type: relay.SENTRY_RELAY_MESSAGE_TYPE, envelope: VALID_ENVELOPE },
        { id: EXT_ID },
        sendResponse
      );

      // Async path: returns true (will respond later), never sync {ok:false}
      expect(result).toBe(true);
      expect(sendResponse).not.toHaveBeenCalledWith({ ok: false });
    });
  });

  describe("Envelope and DSN validation", () => {
    it("rejects an empty envelope with {ok:false}", async () => {
      const { listener, relay } = await registerAndGetListener();
      const sendResponse = vi.fn();

      const result = listener(
        { type: relay.SENTRY_RELAY_MESSAGE_TYPE, envelope: "" },
        { id: EXT_ID },
        sendResponse
      );

      expect(result).toBe(false);
      expect(sendResponse).toHaveBeenCalledWith({ ok: false });
    });

    it("rejects a missing envelope field with {ok:false}", async () => {
      const { listener, relay } = await registerAndGetListener();
      const sendResponse = vi.fn();

      const result = listener(
        { type: relay.SENTRY_RELAY_MESSAGE_TYPE },
        { id: EXT_ID },
        sendResponse
      );

      expect(result).toBe(false);
      expect(sendResponse).toHaveBeenCalledWith({ ok: false });
    });

    it("rejects when WXT_SENTRY_DSN is unset with {ok:false}", async () => {
      vi.stubEnv("WXT_SENTRY_DSN", "");
      const { listener, relay } = await registerAndGetListener();
      const sendResponse = vi.fn();

      const result = listener(
        { type: relay.SENTRY_RELAY_MESSAGE_TYPE, envelope: VALID_ENVELOPE },
        { id: EXT_ID },
        sendResponse
      );

      expect(result).toBe(false);
      expect(sendResponse).toHaveBeenCalledWith({ ok: false });
    });

    it("rejects a malformed DSN with {ok:false} (URL parse throws)", async () => {
      vi.stubEnv("WXT_SENTRY_DSN", ":::not-a-url");
      const { listener, relay } = await registerAndGetListener();
      const sendResponse = vi.fn();

      const result = listener(
        { type: relay.SENTRY_RELAY_MESSAGE_TYPE, envelope: VALID_ENVELOPE },
        { id: EXT_ID },
        sendResponse
      );

      expect(result).toBe(true); // async path entered…
      expect(sendResponse).toHaveBeenCalledWith({ ok: false }); // …but URL failed
    });
  });

  describe("Relay fetch behavior", () => {
    it("POSTs the envelope to the DSN's /api/{projectId}/envelope/ endpoint and responds {ok:true}", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response("OK"));
      vi.stubGlobal("fetch", fetchMock);

      const { listener, relay } = await registerAndGetListener();
      const sendResponse = vi.fn();

      const result = listener(
        { type: relay.SENTRY_RELAY_MESSAGE_TYPE, envelope: VALID_ENVELOPE },
        { id: EXT_ID },
        sendResponse
      );
      expect(result).toBe(true);

      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));
      expect(sendResponse).toHaveBeenCalledWith({ ok: true });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://sentry.io/api/42/envelope/",
        {
          method: "POST",
          body: VALID_ENVELOPE,
          headers: { "Content-Type": "application/x-sentry-envelope" },
        }
      );
    });

    it("responds {ok:false} when the ingest fetch rejects", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
      vi.stubGlobal("fetch", fetchMock);

      const { listener, relay } = await registerAndGetListener();
      const sendResponse = vi.fn();

      listener(
        { type: relay.SENTRY_RELAY_MESSAGE_TYPE, envelope: VALID_ENVELOPE },
        { id: EXT_ID },
        sendResponse
      );

      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));
      expect(sendResponse).toHaveBeenCalledWith({ ok: false });
    });
  });

  describe("Constants", () => {
    it("exports SENTRY_RELAY_MESSAGE_TYPE as 'sentry-relay'", async () => {
      const relay = await loadActualRelay();
      expect(relay.SENTRY_RELAY_MESSAGE_TYPE).toBe("sentry-relay");
    });
  });
});
