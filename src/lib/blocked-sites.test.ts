import { describe, it, expect } from "vitest";
import {
  normalizeHostname,
  isHostnameBlocked,
  addBlockedSite,
  parseRegexEntry,
  getFaviconDomain,
} from "./blocked-sites";

// ---------------------------------------------------------------------------
// parseRegexEntry
// ---------------------------------------------------------------------------

describe("parseRegexEntry", () => {
  it("parses a delimited pattern with its flags", () => {
    const regex = parseRegexEntry("/^mail\\..*example\\.com$/i");

    // The pattern must actually be compiled, not only recognised by shape.
    expect(regex?.test("MAIL.example.com")).toBe(true);
    expect(regex?.test("www.example.com")).toBe(false);
    expect(regex?.flags).toBe("i");
  });

  it("keeps escaped slashes inside the source", () => {
    expect(parseRegexEntry("/a\\/b/i")?.source).toBe("a\\/b");
  });

  it("rejects plain hostnames, partial patterns and invalid regexes", () => {
    // Each of these would be stored as an ineffective entry if accepted.
    expect(parseRegexEntry("example.com")).toBeNull();
    expect(parseRegexEntry("/mail\\.")).toBeNull();
    expect(parseRegexEntry("/(/i")).toBeNull();
    expect(parseRegexEntry("//i")).toBeNull();
  });

  it("rejects stateful and unknown flags", () => {
    // `g`/`y` make repeated .test() calls alternate results on one page.
    expect(parseRegexEntry("/example/g")).toBeNull();
    expect(parseRegexEntry("/example/y")).toBeNull();
    expect(parseRegexEntry("/example/x")).toBeNull();
  });

  it("rejects an unbounded pattern source", () => {
    expect(parseRegexEntry(`/${"a".repeat(201)}/i`)).toBeNull();
  });
});

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

  it("preserves a regex entry instead of lowering or splitting its source", () => {
    expect(normalizeHostname("  /MAIL\\.(Example|Test)\\.com/i ")).toBe(
      "/MAIL\\.(Example|Test)\\.com/i"
    );
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

  describe("full regex entries", () => {
    it("blocks a hostname matched by the regex", () => {
      expect(
        isHostnameBlocked("mail.example.com", ["/^mail\\..*example\\.com$/i"])
      ).toBe(true);
    });

    it("does not block a hostname the regex rejects", () => {
      expect(
        isHostnameBlocked("www.example.com", ["/^mail\\..*example\\.com$/i"])
      ).toBe(false);
    });

    it("honours a case-sensitive pattern", () => {
      expect(isHostnameBlocked("mail.example.com", ["/MAIL/"])).toBe(false);
    });

    it("ignores a malformed regex instead of blocking every site", () => {
      expect(isHostnameBlocked("example.com", ["/(/i"])).toBe(false);
    });

    it("ignores a stateful regex", () => {
      expect(isHostnameBlocked("example.com", ["/example/g"])).toBe(false);
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

  it("stores a regex entry with its source and flags intact", () => {
    expect(addBlockedSite([], " /MAIL\\.(Example|Test)\\.com/i ")).toEqual([
      "/MAIL\\.(Example|Test)\\.com/i",
    ]);
  });

  it("does not duplicate an existing regex entry", () => {
    expect(addBlockedSite(["/mail\\./i"], "/mail\\./i")).toEqual([
      "/mail\\./i",
    ]);
  });

  it("treats the same regex with different flags as a new entry", () => {
    expect(addBlockedSite(["/mail\\./i"], "/mail\\./m")).toEqual([
      "/mail\\./i",
      "/mail\\./m",
    ]);
  });

  it("still returns a new array when a regex is rejected", () => {
    const original = ["/mail\\./i"];
    const result = addBlockedSite(original, "");
    expect(result).not.toBe(original);
    expect(result).toEqual(original);
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

  it("a regex stored via addBlockedSite blocks only what it matches", () => {
    const patterns = addBlockedSite([], "/^mail\\..*example\\.com$/i");
    expect(isHostnameBlocked("MAIL.Example.com", patterns)).toBe(true);
    expect(isHostnameBlocked("example.com", patterns)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Legacy stored entries
//
// The writer learned to strip a port and scheme, but entries written before
// that are still in users' storage. Matching must normalize them too, or a
// site the user blocked stays unblocked forever.
// ---------------------------------------------------------------------------

describe("isHostnameBlocked — legacy stored entries", () => {
  it("matches an entry stored with an explicit port", () => {
    expect(
      isHostnameBlocked("mail.example.com", ["mail.example.com:443"])
    ).toBe(true);
  });

  it("matches an entry stored as a full URL", () => {
    expect(
      isHostnameBlocked("mail.example.com", ["https://mail.example.com/inbox"])
    ).toBe(true);
  });

  it("matches an entry stored with a trailing dot", () => {
    expect(isHostnameBlocked("example.com", ["example.com."])).toBe(true);
  });

  it("matches an entry stored with mixed case and padding", () => {
    expect(isHostnameBlocked("example.com", ["  EXAMPLE.com  "])).toBe(true);
  });

  it("still honours a legacy wildcard entry", () => {
    expect(isHostnameBlocked("mail.example.com", ["*.Example.com"])).toBe(true);
  });

  it("still requires a real subdomain for a legacy wildcard entry", () => {
    expect(isHostnameBlocked("example.com", ["*.Example.com"])).toBe(false);
  });

  it("normalizes the target hostname too", () => {
    // location.hostname is always lowercase, but be robust if a caller
    // passes something else.
    expect(isHostnameBlocked("MAIL.Example.com", ["mail.example.com"])).toBe(
      true
    );
  });

  it("returns false for an empty target hostname", () => {
    // file:// reports an empty hostname; it must stay unblocked.
    expect(isHostnameBlocked("", ["example.com"])).toBe(false);
  });

  it("still never blocks an empty-string pattern against an empty hostname", () => {
    expect(isHostnameBlocked("", [""])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getFaviconDomain
// ---------------------------------------------------------------------------

describe("getFaviconDomain", () => {
  it("derives a domain from a wildcard entry", () => {
    expect(getFaviconDomain("*.example.com")).toBe("example.com");
  });

  it("derives a domain from a pasted URL", () => {
    expect(getFaviconDomain("https://Mail.Example.com/inbox")).toBe(
      "mail.example.com"
    );
  });

  it("returns null while the typed text is not yet a domain", () => {
    expect(getFaviconDomain("exa")).toBeNull();
    expect(getFaviconDomain("")).toBeNull();
  });

  it("returns null for a regex entry, which has no single domain", () => {
    expect(getFaviconDomain("/mail\\..*\\.example\\.com/i")).toBeNull();
  });

  it("returns null for text that is not a hostname", () => {
    expect(getFaviconDomain("not a hostname")).toBeNull();
    expect(getFaviconDomain("example.com-")).toBeNull();
  });
});
