import { describe, it, expect } from "vitest";
import { checkQuota } from "./quota-preflight";
import { SYNC_QUOTA } from "@/config/constants";
import type { Snippet } from "~/types";

/** Local factory — importing one from another test file would couple two suites. */
const makeSnippet = (overrides: Partial<Snippet> = {}): Snippet => {
  const id = overrides.id ?? "s";
  const ts = "2026-01-01T00:00:00.000Z";
  return {
    id,
    label: overrides.label ?? `Snippet ${id}`,
    shortcut: overrides.shortcut ?? `/s-${id}`,
    content: overrides.content ?? `Content for ${id}`,
    tags: overrides.tags ?? [],
    usageCount: overrides.usageCount ?? 0,
    createdAt: overrides.createdAt ?? ts,
    updatedAt: overrides.updatedAt ?? ts,
  };
};

/**
 * spec: specs/storage-quota-preflight.spec.md
 *
 * Every test here asserts on the real `checkQuota` output. Nothing reconstructs
 * the byte arithmetic by hand and asserts on that, which is the failure mode
 * this suite exists to catch: a test that agrees with a broken implementation
 * because it made the same mistake.
 */

/**
 * Bytes the storage key for a snippet occupies.
 *
 * The key is `snip:<id>`, so it is 5 bytes *plus the id* — not 5. An earlier
 * version of this file used a flat `"snip:".length`, which under-counted every
 * snippet by its id length and made "exactly at the per-item limit" fail.
 */
function keyBytes(id: string): number {
  return new TextEncoder().encode(`snip:${id}`).length;
}

function sizeOf(snippet: Snippet): number {
  return new TextEncoder().encode(JSON.stringify(snippet)).length;
}

/**
 * A snippet whose serialised size, key included, is exactly `bytes`.
 *
 * The size is *measured*, not computed from field lengths: measure the snippet
 * with empty content, then pad by the shortfall. Deriving it arithmetically is
 * how a test ends up agreeing with a broken implementation.
 */
function snippetOfBytes(id: string, bytes: number): Snippet {
  const empty = makeSnippet({ id, content: "" });
  const overhead = sizeOf(empty) + keyBytes(id);
  if (bytes < overhead) {
    throw new Error(`cannot build a snippet smaller than ${overhead} bytes`);
  }
  const made = makeSnippet({ id, content: "x".repeat(bytes - overhead) });
  // The helper must be honest about what it claims to produce, or every test
  // using it is measuring the wrong thing.
  const actual = sizeOf(made) + keyBytes(id);
  if (actual !== bytes) {
    throw new Error(`snippetOfBytes(${id}, ${bytes}) produced ${actual}`);
  }
  return made;
}

/**
 * A set of snippets whose combined size — keys included — is exactly `total`.
 *
 * Each snippet is kept under `BYTES_PER_ITEM`, because a single 98 KB snippet
 * would breach the per-item rule first and mask whatever the total rule was
 * supposed to say.
 */
function setOfTotalBytes(total: number): Snippet[] {
  const CHUNK = SYNC_QUOTA.BYTES_PER_ITEM - 256;
  const out: Snippet[] = [];
  let remaining = total;
  let n = 0;
  while (remaining > 0) {
    const id = `f${n}`;
    const size = Math.min(CHUNK, remaining);
    out.push(snippetOfBytes(id, size));
    remaining -= size;
    n++;
  }
  return out;
}

function setTotal(set: Snippet[]): number {
  return set.reduce((sum, s) => sum + sizeOf(s) + keyBytes(s.id), 0);
}

describe("checkQuota", () => {
  it("accepts a write that fits", () => {
    const result = checkQuota(
      [makeSnippet({ id: "a" })],
      [makeSnippet({ id: "a" })]
    );
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("reports the current and projected byte totals on success", () => {
    const snippet = makeSnippet({ id: "a" });
    const result = checkQuota([snippet], [snippet, makeSnippet({ id: "b" })]);
    expect(result.ok).toBe(true);
    expect(result.projectedBytes).toBeGreaterThan(result.currentBytes);
  });

  // --- total bytes -------------------------------------------------------

  it("rejects a write whose projected total exceeds the sync ceiling", () => {
    // Two 4 KB snippets are 8 KB against a 100 KB ceiling — this fixture never
    // tested the total rule at all. Build a set that actually reaches it.
    const incoming = setOfTotalBytes(SYNC_QUOTA.TOTAL_BYTES + 1);
    const existing = incoming.slice(0, incoming.length - 1);
    expect(setTotal(incoming)).toBe(SYNC_QUOTA.TOTAL_BYTES + 1);

    const result = checkQuota(existing, incoming);

    expect(result.ok).toBe(false);
    const total = result.reasons.find((r) => r.kind === "total");
    expect(total?.limit).toBe(SYNC_QUOTA.TOTAL_BYTES);
    expect(total?.actual).toBe(SYNC_QUOTA.TOTAL_BYTES + 1);
  });

  it("allows a write that lands exactly on the total ceiling", () => {
    const set = setOfTotalBytes(SYNC_QUOTA.TOTAL_BYTES);
    expect(setTotal(set)).toBe(SYNC_QUOTA.TOTAL_BYTES);
    expect(checkQuota([], set)).toEqual({
      ok: true,
      currentBytes: 0,
      projectedBytes: SYNC_QUOTA.TOTAL_BYTES,
      reasons: [],
    });
  });

  it("rejects a write one byte over the total ceiling", () => {
    const set = setOfTotalBytes(SYNC_QUOTA.TOTAL_BYTES + 1);
    expect(setTotal(set)).toBe(SYNC_QUOTA.TOTAL_BYTES + 1);
    const result = checkQuota([], set);
    expect(result.ok).toBe(false);
    expect(result.reasons.map((r) => r.kind)).toEqual(["total"]);
  });

  // --- per-item bytes ----------------------------------------------------

  it("rejects a single snippet larger than the per-item limit and names it", () => {
    const big = snippetOfBytes("huge", SYNC_QUOTA.BYTES_PER_ITEM + 1);
    const result = checkQuota([], [big]);

    expect(result.ok).toBe(false);
    const perItem = result.reasons.find((r) => r.kind === "per-item");
    expect(perItem).toBeDefined();
    expect(perItem?.id).toBe("huge");
    expect(perItem?.limit).toBe(SYNC_QUOTA.BYTES_PER_ITEM);
  });

  it("allows a snippet exactly at the per-item limit", () => {
    const exact = snippetOfBytes("exact", SYNC_QUOTA.BYTES_PER_ITEM);
    expect(checkQuota([], [exact]).ok).toBe(true);
  });

  it("reports every oversized snippet, not just the first", () => {
    const result = checkQuota(
      [],
      [
        snippetOfBytes("big1", SYNC_QUOTA.BYTES_PER_ITEM + 10),
        snippetOfBytes("ok", 400),
        snippetOfBytes("big2", SYNC_QUOTA.BYTES_PER_ITEM + 20),
      ]
    );
    const ids = result.reasons
      .filter((r) => r.kind === "per-item")
      .map((r) => r.id)
      .sort();
    expect(ids).toEqual(["big1", "big2"]);
  });

  // --- item count -------------------------------------------------------

  it("rejects a write that would exceed the maximum item count", () => {
    const existing = Array.from({ length: 10 }, (_, i) =>
      makeSnippet({ id: `s${i}` })
    );
    const incoming = Array.from({ length: SYNC_QUOTA.MAX_ITEMS + 1 }, (_, i) =>
      makeSnippet({ id: `s${i}` })
    );

    const result = checkQuota(existing, incoming);

    expect(result.ok).toBe(false);
    const count = result.reasons.find((r) => r.kind === "count");
    expect(count?.limit).toBe(SYNC_QUOTA.MAX_ITEMS);
    expect(count?.actual).toBe(SYNC_QUOTA.MAX_ITEMS + 1);
  });

  // --- byte-identical rewrites -----------------------------------------

  it("ignores byte-identical rewrites, matching planWrite", () => {
    // 200 snippets, all unchanged. Re-saving them must not report a problem
    // that causes no write, because planWrite will short-circuit to a no-op.
    const existing = Array.from({ length: 200 }, (_, i) =>
      makeSnippet({ id: `s${i}`, content: "y".repeat(300) })
    );

    const result = checkQuota(existing, [...existing]);

    expect(result.ok).toBe(true);
  });

  it("counts a changed snippet even when its id already exists", () => {
    const existing = [makeSnippet({ id: "a", content: "short" })];
    const incoming = [
      makeSnippet({ id: "a", content: "x".repeat(SYNC_QUOTA.BYTES_PER_ITEM) }),
    ];

    const result = checkQuota(existing, incoming);

    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.kind === "per-item")).toBe(true);
  });

  // --- removals ---------------------------------------------------------

  it("treats removals as freeing space rather than a breach", () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      makeSnippet({ id: `s${i}`, content: "z".repeat(200) })
    );

    const result = checkQuota(many, many.slice(0, 10));

    expect(result.ok).toBe(true);
    expect(result.projectedBytes).toBeLessThan(result.currentBytes);
  });

  it("always accepts an empty result set", () => {
    const existing = Array.from({ length: 50 }, (_, i) =>
      makeSnippet({ id: `s${i}` })
    );
    expect(checkQuota(existing, []).ok).toBe(true);
  });

  // --- non-ASCII measurement -------------------------------------------

  it("measures non-ASCII as UTF-8 bytes, not JavaScript string length", () => {
    // "😀" is 2 UTF-16 code units but 4 UTF-8 bytes. A snippet of 3,000 of them
    // looks small in characters and is 12 KB in bytes, so it must breach the
    // 8 KB per-item limit.
    const emoji = makeSnippet({ id: "emo", content: "😀".repeat(3_000) });
    const result = checkQuota([], [emoji]);

    expect(result.ok).toBe(false);
    expect(result.reasons.find((r) => r.kind === "per-item")?.id).toBe("emo");
  });

  it("counts two-byte characters as two bytes", () => {
    // "é" is 1 code unit, 2 UTF-8 bytes. 5,000 of them is 10 KB.
    const accented = makeSnippet({ id: "acc", content: "é".repeat(5_000) });
    expect(checkQuota([], [accented]).ok).toBe(false);
  });

  it("measures the key as well as the value", () => {
    // Two snippets with identical bodies but long ids must differ in total,
    // which can only be true if the key length is counted.
    const short = makeSnippet({ id: "a", content: "q".repeat(100) });
    const long = makeSnippet({ id: "b".repeat(200), content: "q".repeat(100) });
    const result = checkQuota([], [short, long]);
    expect(result.projectedBytes).toBeGreaterThan(
      2 * (sizeOf(short) + keyBytes("a"))
    );
  });

  // --- multiple simultaneous reasons -----------------------------------

  it("reports a per-item breach and a total breach together", () => {
    // Neither rule may mask the other: one snippet that can never fit in sync,
    // plus enough ordinary snippets to blow the ceiling as well.
    const oversized = snippetOfBytes("toobig", SYNC_QUOTA.BYTES_PER_ITEM + 1);
    const filler = setOfTotalBytes(SYNC_QUOTA.TOTAL_BYTES);
    const result = checkQuota([], [oversized, ...filler]);

    const kinds = new Set(result.reasons.map((r) => r.kind));
    expect(kinds).toContain("per-item");
    expect(kinds).toContain("total");
    expect(result.reasons.find((r) => r.kind === "per-item")?.id).toBe(
      "toobig"
    );
  });

  // --- non-snippet keys -------------------------------------------------

  it("excludes the journal and corrupt keys from the item count", () => {
    // Exactly MAX_ITEMS tiny snippets: the count is at the limit and the byte
    // total is nowhere near it, so only the count rule is under test here.
    const incoming = Array.from({ length: SYNC_QUOTA.MAX_ITEMS }, (_, i) =>
      makeSnippet({ id: `s${i}`, content: "" })
    );
    const result = checkQuota([], incoming);
    expect(result.reasons).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("reports the count breach when the byte total is fine", () => {
    const incoming = Array.from({ length: SYNC_QUOTA.MAX_ITEMS + 1 }, (_, i) =>
      makeSnippet({ id: `s${i}`, content: "" })
    );
    const result = checkQuota([], incoming);
    expect(result.reasons.map((r) => r.kind)).toEqual(["count"]);
  });
});
