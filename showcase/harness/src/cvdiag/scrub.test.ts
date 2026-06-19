import { describe, it, expect } from "vitest";
import {
  scrubSecrets,
  scrubDeep,
  SCRUB_MAX_SCAN_LEN,
  SCRUB_MAX_NODES,
  SCRUB_REPLACEMENT,
} from "./scrub.js";

// Module-scope leaf functions used as unclonable values across several tests.
// Hoisted out of the `it` bodies so the identity-equality assertions
// (`toBe(fn)`) compare a stable reference and so oxlint's
// `consistent-function-scoping` rule stays clean.
const numberLeaf = (): number => 42;
const voidLeaf = (): void => {};

describe("cvdiag scrub — constants (spec §3.2.4 / §3.2.5)", () => {
  it("pins the size-guard and node-cap constants", () => {
    expect(SCRUB_MAX_SCAN_LEN).toBe(8 * 1024);
    expect(SCRUB_MAX_NODES).toBe(10_000);
    expect(SCRUB_REPLACEMENT).toBe("[REDACTED]");
  });
});

describe("cvdiag scrub — secret corpus (spec §6.1)", () => {
  it("redacts positive secret shapes", () => {
    expect(scrubSecrets("Bearer abc.def")).toContain(SCRUB_REPLACEMENT);
    expect(scrubSecrets("Bearer abc.def")).not.toContain("abc.def");
    expect(scrubSecrets("sk-0123456789abcdef0123")).toBe(SCRUB_REPLACEMENT);
    expect(scrubSecrets("sk-proj-AbCdEf0123456789ghij")).toBe(
      SCRUB_REPLACEMENT,
    );
    expect(scrubSecrets("sk-ant-api03-AbCd_Ef-0123456789xyzAB")).toBe(
      SCRUB_REPLACEMENT,
    );
    expect(scrubSecrets("https://user:pass@host/x")).toBe(
      `https://${SCRUB_REPLACEMENT}@host/x`,
    );
    // bare-token userinfo
    expect(scrubSecrets("https://tok@host/x")).toBe(
      `https://${SCRUB_REPLACEMENT}@host/x`,
    );
    // multi-@ authority: greedy to the last @ within the authority
    expect(scrubSecrets("https://a@b@c.com/x")).toBe(
      `https://${SCRUB_REPLACEMENT}@c.com/x`,
    );
  });

  it("preserves non-secret prose (negative corpus)", () => {
    expect(scrubSecrets("ask-me-later")).toBe("ask-me-later");
    expect(scrubSecrets("task_list_items")).toBe("task_list_items");
    // R5-A2: the @ is after the ? (query, not userinfo) → host MUST survive.
    expect(scrubSecrets("https://host.com?email=a@b.com")).toBe(
      "https://host.com?email=a@b.com",
    );
  });

  it("redacts a genuine userinfo before a query, preserving the query @ (R5-A2)", () => {
    expect(scrubSecrets("https://user:pass@host.com?email=a@b.com")).toBe(
      `https://${SCRUB_REPLACEMENT}@host.com?email=a@b.com`,
    );
  });
});

describe("cvdiag scrub — ReDoS / size guard (spec §6.2)", () => {
  it("completes the historical R5-A1 adversarial input fast (< 50ms)", () => {
    // 4000-char case is UNDER the 8KB guard → exercises the bounded-regex path.
    const adversarial = `sk-${"a".repeat(4000)}`;
    const t0 = performance.now();
    scrubSecrets(adversarial);
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it("stays linear AT the size-guard ceiling (catastrophic SHAPE at exactly 8KB)", () => {
    // The single largest input the guard hands to the regex: classic
    // (a+)+-style trigger structure at exactly SCRUB_MAX_SCAN_LEN.
    const atCeiling = `sk-${"a".repeat(SCRUB_MAX_SCAN_LEN - 3)}`;
    expect(atCeiling.length).toBe(SCRUB_MAX_SCAN_LEN);
    const t0 = performance.now();
    scrubSecrets(atCeiling);
    expect(performance.now() - t0).toBeLessThan(50);

    // Variant interleaving _ and - to maximally exercise the [A-Za-z0-9_-] windows.
    const mixed = `sk-${"a_-".repeat(Math.floor((SCRUB_MAX_SCAN_LEN - 3) / 3))}`;
    const mixedClamped = mixed.slice(0, SCRUB_MAX_SCAN_LEN);
    const t1 = performance.now();
    scrubSecrets(mixedClamped);
    expect(performance.now() - t1).toBeLessThan(50);
  });

  it("does NOT run a regex on a string just over 8KB (bounded-prefix path)", () => {
    const justOver = "x".repeat(SCRUB_MAX_SCAN_LEN + 100);
    const out = scrubSecrets(justOver);
    // The bounded-prefix marker fires and reports the dropped tail length.
    expect(out).toContain("…[unscanned:100]");
    // The scanned prefix is still present (no secret here, so it is the prefix).
    expect(out.startsWith("x")).toBe(true);
  });

  it("scrubs a secret in the scanned prefix even when the tail is dropped", () => {
    const head = "Bearer sk-aaaaaaaaaaaaaaaa ";
    const value = head + "y".repeat(SCRUB_MAX_SCAN_LEN);
    const out = scrubSecrets(value);
    expect(out).toContain(SCRUB_REPLACEMENT);
    expect(out).toContain("…[unscanned:");
  });
});

describe("cvdiag scrubDeep — fresh copy, never mutates caller (spec §6.4 / P3)", () => {
  it("returns a NEW object and leaves the caller's nested object byte-identical", () => {
    const caller = { a: { file: "Bearer sk-aaaaaaaaaaaaaaaa", line: 1 } };
    const snapshot = JSON.parse(JSON.stringify(caller)) as typeof caller;
    const out = scrubDeep(caller) as typeof caller;
    expect(caller).toEqual(snapshot); // caller untouched
    expect(out).not.toBe(caller); // fresh container
    expect(out.a.file).toContain(SCRUB_REPLACEMENT); // scrub applied to the COPY
  });

  it("does not mutate the caller when a leaf is UNCLONABLE (function / class instance)", () => {
    // structuredClone THROWS on a function leaf; the old code fell back to
    // mutating the original (R5-A4). The fresh-copy walker copies the function
    // by reference and never touches the original.
    const fn = numberLeaf;
    const caller: Record<string, unknown> = {
      file: "Bearer sk-aaaaaaaaaaaaaaaa",
      handler: fn,
    };
    // Deep-freeze a structural snapshot proof: freezing the caller means ANY
    // in-place mutation attempt would THROW in strict mode (ESM is strict).
    Object.freeze(caller);
    const snapshotFile = caller.file;
    const out = scrubDeep(caller) as Record<string, unknown>;
    expect(caller.file).toBe(snapshotFile); // original string NOT scrubbed in place
    expect(caller.handler).toBe(fn); // original ref intact
    expect(out.file).toContain(SCRUB_REPLACEMENT); // copy scrubbed
    expect(out.handler).toBe(fn); // function copied by reference, unscrubbed
  });

  it("does not mutate a deeply nested caller object carrying both a secret and a function", () => {
    const fn = voidLeaf;
    const inner = { file: "Bearer sk-aaaaaaaaaaaaaaaa", handler: fn };
    const caller = { stack: [inner] };
    Object.freeze(inner);
    Object.freeze(caller.stack);
    Object.freeze(caller);
    const out = scrubDeep(caller) as { stack: Array<{ file: string }> };
    expect(inner.file).toBe("Bearer sk-aaaaaaaaaaaaaaaa"); // original untouched
    expect(out.stack[0].file).toContain(SCRUB_REPLACEMENT); // copy scrubbed
    expect(out).not.toBe(caller);
    expect(out.stack).not.toBe(caller.stack);
  });

  it("handles a cyclic structure without hanging and preserves sharing", () => {
    const cyclic: Record<string, unknown> = { file: "ok" };
    cyclic.self = cyclic;
    const out = scrubDeep(cyclic) as Record<string, unknown>;
    // Cycle preserved in the COPY (same new container referenced twice).
    expect(out.self).toBe(out);
    expect(out).not.toBe(cyclic);
  });

  it("preserves shared (non-cyclic) sub-structure as the same new container", () => {
    const shared = { file: "Bearer sk-aaaaaaaaaaaaaaaa" };
    const caller = { a: shared, b: shared };
    const out = scrubDeep(caller) as {
      a: { file: string };
      b: { file: string };
    };
    expect(out.a).toBe(out.b); // dedupe preserved
    expect(out.a.file).toContain(SCRUB_REPLACEMENT);
  });

  it("stops descending past SCRUB_MAX_NODES (nesting-bomb bound, copy-by-ref tail)", () => {
    // Build a deep chain > SCRUB_MAX_NODES; scrubDeep must not overflow/hang.
    let node: Record<string, unknown> = { file: "ok" };
    for (let i = 0; i < SCRUB_MAX_NODES + 50; i += 1) node = { child: node };
    expect(() => scrubDeep(node)).not.toThrow();
  });

  it("does not descend into Date/class instances (plain-object/proto guard)", () => {
    const d = new Date(0);
    const out = scrubDeep({ when: d }) as { when: Date };
    expect(out.when).toBe(d); // copied by reference, not walked
  });

  it("copies number/boolean/null leaves unchanged", () => {
    const out = scrubDeep({ n: 1, b: true, z: null }) as Record<
      string,
      unknown
    >;
    expect(out.n).toBe(1);
    expect(out.b).toBe(true);
    expect(out.z).toBeNull();
  });

  it("returns primitives and unclonable top-level values unchanged", () => {
    expect(scrubDeep(42)).toBe(42);
    const fn = voidLeaf;
    expect(scrubDeep(fn)).toBe(fn);
    expect(scrubDeep("Bearer sk-aaaaaaaaaaaaaaaa")).toContain(
      SCRUB_REPLACEMENT,
    );
  });
});
