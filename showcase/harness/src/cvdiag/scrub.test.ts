import { describe, it, expect } from "vitest";
import {
  scrubSecrets,
  scrubDeep,
  SCRUB_MAX_SCAN_LEN,
  SCRUB_MAX_NODES,
  SCRUB_REPLACEMENT,
  SK_KEY_REGEX,
} from "./scrub.js";

// Module-scope leaf functions used as unclonable values across several tests.
// Hoisted out of the `it` bodies so the identity-equality assertions
// (`toBe(fn)`) compare a stable reference and so oxlint's
// `consistent-function-scoping` rule stays clean.
const numberLeaf = (): number => 42;
const voidLeaf = (): void => {};

// ── ReDoS-timing helpers (module scope: capture nothing, so oxlint's
// `consistent-function-scoping` rule stays clean — same reason as the leaves
// above). Shared by the §6.2 ReDoS block. ─────────────────────────────────

/**
 * Best (minimum) wall-time of `fn()` over several runs. The MIN is robust to
 * machine-load jitter: a slow run can only be ≥ the true cost, so the floor
 * approximates the genuine work and is what makes timing assertions stable on
 * a loaded CI box.
 */
const bestMs = (fn: () => void, runs = 12): number => {
  let best = Infinity;
  for (let i = 0; i < runs; i += 1) {
    const t0 = performance.now();
    fn();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
};

/**
 * Drive ONLY the catastrophic-backtracking surface — the SK_KEY_REGEX match
 * engine — with no result-string allocation. Wall-time of full `scrubSecrets`
 * is dominated by output-string ALLOCATION (linear, but GC-noisy and crossing
 * size buckets between 1KB↔2KB), which swamps the regex cost and makes a
 * doubling-ratio assertion on it flaky. Exhausting the regex via `exec`
 * isolates the actual ReDoS work (backtracking), whose ratio is stable.
 */
const exhaustSkRegex = (value: string): void => {
  SK_KEY_REGEX.lastIndex = 0;
  while (SK_KEY_REGEX.exec(value) !== null) {
    /* advance lastIndex; we only care about the match cost */
  }
  SK_KEY_REGEX.lastIndex = 0;
};

/** A catastrophic (a+)+-style `sk-`-prefixed shape of total length `n`. */
const adversarialShape = (n: number): string =>
  `sk-${"a".repeat(n)}`.slice(0, n);

describe("cvdiag scrub — constants (spec §3.2.4 / §3.2.5)", () => {
  it("pins the size-guard and node-cap constants", () => {
    expect(SCRUB_MAX_SCAN_LEN).toBe(2 * 1024);
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
  it("completes the historical R5-A1 adversarial input fast (no ReDoS)", () => {
    // The classic (a+)+-style trigger that stalled the OLD regex ~1.4s at 4000
    // chars. Clamped to the guard ceiling so it exercises the bounded-regex
    // path through the PUBLIC scrub. The absolute ceiling is GENEROUS
    // (400ms ≪ the old seconds-scale blowup; a true exponential ReDoS is
    // seconds) so it decisively catches catastrophic backtracking without
    // flaking under load.
    const adversarial = adversarialShape(SCRUB_MAX_SCAN_LEN);
    expect(bestMs(() => scrubSecrets(adversarial))).toBeLessThan(400);
  });

  it("stays LINEAR (non-catastrophic) as the catastrophic shape doubles in size", () => {
    // Structural ReDoS proof, independent of absolute machine speed: drive the
    // catastrophic (a+)+-style shape through the SK_KEY_REGEX match engine at
    // length L and 2L (both ≤ SCRUB_MAX_SCAN_LEN, so both fully exercise the
    // regex). A backtracking blowup is super-linear — quadratic ≈ 4×,
    // exponential astronomically more (a true ReDoS regex measures ~25× for a
    // tiny size bump). A linear scan is ~1–2×. Asserting time(2L) < 4×time(L)
    // catches catastrophic backtracking while tolerating linear overhead and
    // timer granularity (the +epsilon floor).
    const L = 1024; // 1KB ≤ 2KB ceiling
    const twoL = 2 * 1024; // 2KB = ceiling → still runs the regex
    expect(twoL).toBeLessThanOrEqual(SCRUB_MAX_SCAN_LEN);

    // Warm up the regex/JIT so first-call compilation does not skew the ratio.
    exhaustSkRegex(adversarialShape(L));
    exhaustSkRegex(adversarialShape(twoL));

    const tL = bestMs(() => exhaustSkRegex(adversarialShape(L)));
    const t2L = bestMs(() => exhaustSkRegex(adversarialShape(twoL)));
    // epsilon absorbs the sub-microsecond timer floor on a fast linear match.
    const epsilon = 1; // ms
    expect(t2L).toBeLessThan(4 * tL + epsilon);

    // Variant interleaving _ and - to maximally exercise the [A-Za-z0-9_-]
    // windows at the ceiling through the PUBLIC scrub — still bounded, fast.
    const mixed = `sk-${"a_-".repeat(Math.floor((SCRUB_MAX_SCAN_LEN - 3) / 3))}`;
    const mixedClamped = mixed.slice(0, SCRUB_MAX_SCAN_LEN);
    expect(bestMs(() => scrubSecrets(mixedClamped))).toBeLessThan(400);
  });

  it("does NOT run a regex on a string just over the size guard (bounded-prefix path)", () => {
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

  it("default param still enforces the 2KB metadata guard; an explicit larger cap does NOT truncate", () => {
    const big = "x".repeat(5000);
    // DEFAULT param (metadata hot path): the 2KB guard still fires.
    const metaOut = scrubSecrets(big);
    expect(metaOut).toContain(`…[unscanned:${5000 - SCRUB_MAX_SCAN_LEN}]`);
    expect(metaOut.length).toBeLessThan(big.length);
    // EXPLICIT larger cap (the raw-byte pipeline's own budget): no truncation.
    const rawOut = scrubSecrets(big, 32768);
    expect(rawOut).not.toContain("…[unscanned:");
    expect(rawOut).toBe(big); // no secret present → returned verbatim, full length
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

/**
 * Spec §7 migration / back-compat: the historical scrub surface is RE-exported
 * through `edge-headers.ts` (consumers like `raw-byte-capture.ts` import the
 * scrub from `edge-headers.js`, not `scrub.js`). `SK_KEY_REGEX` and
 * `URL_USERINFO_REGEX` changed VALUE in the redesign but kept their NAMES, so a
 * consumer's import specifier must still resolve. `EDGE_HEADER_MAX_LEN` is
 * DEFINED in `edge-headers.ts` (not re-exported) and is asserted here as part of
 * the public surface check.
 */
describe("cvdiag scrub — back-compat re-exports (spec §7)", () => {
  it("re-exports the scrub symbols + exposes EDGE_HEADER_MAX_LEN via edge-headers.ts", async () => {
    const m = await import("./edge-headers.js");
    expect(typeof m.scrubSecrets).toBe("function");
    expect(typeof m.scrubDeep).toBe("function");
    expect(m.SCRUB_REPLACEMENT).toBe("[REDACTED]");
    expect(m.BEARER_TOKEN_REGEX).toBeInstanceOf(RegExp);
    expect(m.SK_KEY_REGEX).toBeInstanceOf(RegExp);
    expect(m.URL_USERINFO_REGEX).toBeInstanceOf(RegExp);
    expect(m.EDGE_HEADER_MAX_LEN).toBe(256);
  });

  it("the re-exported scrub symbols are the SAME identities as scrub.ts's exports", async () => {
    const edge = await import("./edge-headers.js");
    const scrub = await import("./scrub.js");
    expect(edge.SK_KEY_REGEX).toBe(scrub.SK_KEY_REGEX);
    expect(edge.URL_USERINFO_REGEX).toBe(scrub.URL_USERINFO_REGEX);
    expect(edge.BEARER_TOKEN_REGEX).toBe(scrub.BEARER_TOKEN_REGEX);
    expect(edge.scrubSecrets).toBe(scrub.scrubSecrets);
    expect(edge.scrubDeep).toBe(scrub.scrubDeep);
  });
});
