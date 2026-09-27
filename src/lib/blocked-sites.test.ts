// spec: specs/blocked-sites.spec.md
import { describe, it, expect } from "vitest";
import {
  normalizeHostname,
  isHostnameBlocked,
  addBlockedSite,
} from "./blocked-sites";

// ---------------------------------------------------------------------------
// normalizeHostname
// ---------------------------------------------------------------------------

describe("normalizeHostname", () => {
  it("returns a bare hostname unchanged", () => {
    expect(normalizeHostname("example.com")).toBe("example.com");
  });

  it("strips an https scheme", () => {
    expect(normalizeHostname("https://example.com")).toBe("example.com");
  });

  it("strips an http scheme", () => {
    expect(normalizeHostname("http://example.com")).toBe("example.com");
  });

  it("is case insensitive on the scheme", () => {
    expect(normalizeHostname("HTTPS://Example.com")).toBe("example.com");
  });

  it("lowercases the hostname", () => {
    expect(normalizeHostname("Mail.Example.COM")).toBe("mail.example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeHostname("   example.com   ")).toBe("example.com");
  });

  it("strips the path", () => {
    expect(normalizeHostname("example.com/some/path")).toBe("example.com");
  });

  it("strips the query string", () => {
    expect(normalizeHostname("example.com/?utm=1")).toBe("example.com");
  });

  it("strips the fragment", () => {
    expect(normalizeHostname("example.com/#section")).toBe("example.com");
  });

  it("strips a trailing dot (fully qualified domain form)", () => {
    expect(normalizeHostname("example.com.")).toBe("example.com");
  });

  it("preserves a wildcard prefix", () => {
    expect(normalizeHostname("*.Example.com")).toBe("*.example.com");
  });

  it("returns an empty string for input that is only a scheme", () => {
    expect(normalizeHostname("https://")).toBe("");
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(normalizeHostname("   ")).toBe("");
  });

  it("handles a full URL with scheme, path, query and fragment together", () => {
    expect(
      normalizeHostname("  HTTPS://Mail.Example.com:443/inbox?a=1#b  ")
    ).toBe("mail.example.com");
  });
});

// ---------------------------------------------------------------------------
// isHostnameBlocked
// ---------------------------------------------------------------------------

describe("isHostnameBlocked", () => {
  describe("exact matches", () => {
    it("blocks an exact hostname match", () => {
      expect(isHostnameBlocked("example.com", ["example.com"])).toBe(true);
    });

    it("does not block a different hostname", () => {
      expect(isHostnameBlocked("other.com", ["example.com"])).toBe(false);
    });

    it("does not treat an exact pattern as a suffix match", () => {
      // "example.com" is exact-only; it must not cover subdomains.
      expect(isHostnameBlocked("mail.example.com", ["example.com"])).toBe(
        false
      );
    });

    it("does not match a hostname that merely contains the pattern", () => {
      expect(isHostnameBlocked("notexample.com", ["example.com"])).toBe(false);
    });

    it("does not match a hostname that merely ends with the pattern", () => {
      expect(isHostnameBlocked("myexample.com", ["example.com"])).toBe(false);
    });
  });

  describe("wildcard subdomain patterns", () => {
    it("blocks a direct subdomain", () => {
      expect(isHostnameBlocked("mail.example.com", ["*.example.com"])).toBe(
        true
      );
    });

    it("blocks a deep subdomain", () => {
      expect(isHostnameBlocked("app.sub.example.com", ["*.example.com"])).toBe(
        true
      );
    });

    it("does not block the bare apex domain", () => {
      // Documented, deliberate: "*.example.com" requires a real subdomain.
      expect(isHostnameBlocked("example.com", ["*.example.com"])).toBe(false);
    });

    it("does not block a domain that merely ends with the wildcard text", () => {
      expect(isHostnameBlocked("evil-example.com", ["*.example.com"])).toBe(
        false
      );
    });

    it("blocks a wildcard pattern when the apex is also listed explicitly", () => {
      const patterns = ["*.example.com", "example.com"];
      expect(isHostnameBlocked("mail.example.com", patterns)).toBe(true);
      expect(isHostnameBlocked("example.com", patterns)).toBe(true);
    });
  });

  describe("case handling", () => {
    it("matches a lowercase hostname against an uppercase pattern", () => {
      expect(isHostnameBlocked("example.com", ["EXAMPLE.COM"])).toBe(true);
    });

    it("matches an uppercase hostname against a lowercase pattern", () => {
      expect(isHostnameBlocked("EXAMPLE.COM", ["example.com"])).toBe(true);
    });

    it("matches a wildcard pattern case-insensitively", () => {
      expect(isHostnameBlocked("Mail.Example.com", ["*.EXAMPLE.com"])).toBe(
        true
      );
    });
  });

  describe("empty and malformed input (negative cases)", () => {
    it("never blocks when the blocklist is empty", () => {
      expect(isHostnameBlocked("example.com", [])).toBe(false);
    });

    it("never blocks when the blocklist is null-ish at runtime", () => {
      // Defensive: storage could hand back a non-array if a future migration
      // changes the shape.
      expect(
        isHostnameBlocked("example.com", undefined as unknown as string[])
      ).toBe(false);
    });

    it("ignores an empty-string pattern instead of blocking everything", () => {
      // The critical negative case: an empty pattern must NOT match an empty
      // hostname, which would block file:// and about: pages globally.
      expect(isHostnameBlocked("", [""])).toBe(false);
    });

    it("ignores a whitespace-only pattern", () => {
      expect(isHostnameBlocked("example.com", ["   "])).toBe(false);
    });

    it("does not block an empty hostname against a real pattern", () => {
      // file:// reports an empty hostname; it must stay unblocked.
      expect(isHostnameBlocked("", ["example.com"])).toBe(false);
    });

    it("ignores a bare wildcard pattern with no base domain", () => {
      expect(isHostnameBlocked("example.com", ["*."])).toBe(false);
    });
  });

  describe("multiple patterns", () => {
    it("blocks when any pattern matches", () => {
      const patterns = ["a.com", "b.com", "c.com"];
      expect(isHostnameBlocked("b.com", patterns)).toBe(true);
    });

    it("does not block when no pattern matches", () => {
      const patterns = ["a.com", "b.com"];
      expect(isHostnameBlocked("z.com", patterns)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// addBlockedSite
// ---------------------------------------------------------------------------

describe("addBlockedSite", () => {
  it("appends a new hostname", () => {
    expect(addBlockedSite([], "example.com")).toEqual(["example.com"]);
  });

  it("preserves existing order", () => {
    expect(addBlockedSite(["a.com", "b.com"], "c.com")).toEqual([
      "a.com",
      "b.com",
      "c.com",
    ]);
  });

  it("does not duplicate an existing entry", () => {
    expect(addBlockedSite(["a.com", "b.com"], "b.com")).toEqual([
      "a.com",
      "b.com",
    ]);
  });

  it("treats a differently-cased duplicate as already present", () => {
    expect(addBlockedSite(["example.com"], "EXAMPLE.COM")).toEqual([
      "example.com",
    ]);
  });

  it("normalizes the hostname before storing it", () => {
    expect(addBlockedSite([], "https://Mail.Example.com/inbox")).toEqual([
      "mail.example.com",
    ]);
  });

  it("returns the list unchanged for an empty hostname", () => {
    expect(addBlockedSite(["a.com"], "")).toEqual(["a.com"]);
  });

  it("returns a new array rather than mutating the input", () => {
    const original = ["a.com"];
    const result = addBlockedSite(original, "b.com");
    expect(result).not.toBe(original);
    expect(original).toEqual(["a.com"]);
  });

  it("stores a wildcard pattern as a wildcard", () => {
    expect(addBlockedSite([], "*.Example.com")).toEqual(["*.example.com"]);
  });
});

// ---------------------------------------------------------------------------
// Cross-function invariant: what is stored is what matches
// ---------------------------------------------------------------------------

describe("normalizeHostname / isHostnameBlocked round trip", () => {
  it("a hostname stored via addBlockedSite blocks that same hostname", () => {
    const patterns = addBlockedSite([], "HTTPS://Mail.Example.com/inbox");
    expect(isHostnameBlocked("mail.example.com", patterns)).toBe(true);
  });

  it("a hostname stored via addBlockedSite does not block a subdomain", () => {
    const patterns = addBlockedSite([], "example.com");
    expect(isHostnameBlocked("mail.example.com", patterns)).toBe(false);
  });

  it("a wildcard stored via addBlockedSite blocks subdomains but not the apex", () => {
    const patterns = addBlockedSite([], "*.example.com");
    expect(isHostnameBlocked("mail.example.com", patterns)).toBe(true);
    expect(isHostnameBlocked("example.com", patterns)).toBe(false);
  });
});
