/**
 * emit.test.ts — `CvdiagEmitter` byte-cap enforcement (spec §7 R5-F3) and
 * flush()/queue_dropped accounting robustness.
 *
 * Byte-cap focus: `applyByteCap` must bound the WHOLE serialized envelope to the
 * tier byte cap, not merely stamp `_truncated: true`. An over-cap envelope whose
 * excess comes from many short-string / numeric metadata values (each ≤64
 * chars, so the legacy >64-char/object trim pass never touches them) must STILL
 * be brought under cap before enqueue — otherwise the contract "the whole
 * serialized envelope must fit the tier byte cap" is violable.
 *
 * Flush focus: a queue overflow must surface exactly one `cvdiag.queue_dropped`
 * accounting event carrying the drop count INTO the flushed batch, and the drop
 * count must never be silently lost when the accounting envelope fails to build.
 *
 * Accounting (`cvdiag.*`) boundaries carry their metadata bag verbatim (no
 * closed-world filter), so they are the cleanest over-cap trigger that survives
 * validateMetadata and validateEnvelope.
 */

import { describe, expect, it } from "vitest";

import {
  BYTE_CAP_BY_TIER,
  CvdiagEmitter,
  DEMO_MAX_LEN,
  QUEUE_CAP,
  SLUG_FALLBACK,
  boundEntryFields,
  mintTestId,
} from "./emit.js";
import type { CvdiagPbWriter } from "./emit.js";
import type { CvdiagEmitArgs } from "./emit.js";
import { isValidTestId } from "./schema.js";
import type { CvdiagEnvelope, EdgeHeaders } from "./schema.js";
import { scrubSecrets } from "./scrub.js";

/** Buffer byte length of the JSON serialization (mirrors emit's serializedSize). */
function serializedSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

/**
 * Build an over-cap metadata bag out of MANY SHORT, scalar values: each value
 * is a ≤64-char string or a number, so the legacy trim pass (which only clamps
 * strings longer than 64 chars and replaces objects) cannot shrink any of them.
 */
function scalarHeavyMetadata(keyCount: number): Record<string, unknown> {
  const bag: Record<string, unknown> = {};
  for (let i = 0; i < keyCount; i += 1) {
    // Short string (8 chars) for even keys, a number for odd keys — neither is
    // reachable by the legacy >64-char/object trim pass.
    bag[`k${i.toString().padStart(4, "0")}`] =
      i % 2 === 0 ? "xxxxxxxx" : 1234567890;
  }
  return bag;
}

/**
 * Build an `EdgeHeaders` with ALL 9 keys set to the same `filler` string. Used
 * to drive the byte-cap ladder's edge-header clamp: each value at the
 * EDGE_HEADER_MAX_LEN char bound, summed across 9 keys, exceeds the default
 * tier byte cap (especially with multi-byte chars). Module-scope to satisfy
 * `consistent-function-scoping` (mirrors `scalarHeavyMetadata`).
 */
function allEdgeHeaders(filler: string): EdgeHeaders {
  return {
    "cf-ray": filler,
    "cf-mitigated": filler,
    "cf-cache-status": filler,
    "x-railway-edge": filler,
    "x-railway-request-id": filler,
    "x-hikari-trace": filler,
    "retry-after": filler,
    via: filler,
    server: filler,
  };
}

/**
 * A `CvdiagPbWriter` test double that captures every batch handed to
 * `writeBatch`. Resolves (never rejects), matching the best-effort seam
 * contract.
 */
class CapturingPbWriter implements CvdiagPbWriter {
  readonly batches: CvdiagEnvelope[][] = [];
  async writeBatch(events: CvdiagEnvelope[]): Promise<void> {
    // Capture a snapshot (callers may mutate/reuse arrays).
    this.batches.push([...events]);
  }
}

/** Emit N data-plane events that pass the default-tier filter. */
function emitN(emitter: CvdiagEmitter, n: number): void {
  for (let i = 0; i < n; i++) {
    emitter.emit({
      layer: "probe",
      boundary: "probe.message.send", // default: true → always queued
      slug: "langgraph-python",
      demo: "chat",
      outcome: "info",
      metadata: { idx: i },
    });
  }
}

describe("CvdiagEmitter.applyByteCap", () => {
  it("bounds a scalar/short-string-heavy accounting envelope to the default tier cap", () => {
    const emitter = new CvdiagEmitter({ env: { NODE_ENV: "test" } });
    const cap = BYTE_CAP_BY_TIER.default; // 2KB

    // Sanity: the raw metadata bag alone blows past the cap with short scalars
    // (no >64-char strings, no objects → legacy trim is a no-op on it).
    const metadata = scalarHeavyMetadata(200);
    expect(serializedSize(metadata)).toBeGreaterThan(cap);

    // Accounting boundary rides metadata verbatim (survives validateMetadata).
    const envelope = emitter.emit({
      layer: "probe",
      boundary: "cvdiag.queue_dropped",
      slug: "cvdiag",
      demo: "cvdiag",
      outcome: "info",
      metadata,
    });

    expect(envelope).not.toBeNull();
    const env = envelope!;

    // The whole serialized envelope must fit the tier byte cap (the contract).
    expect(serializedSize(env)).toBeLessThanOrEqual(cap);
    // Any trimming occurred → _truncated stamped true.
    expect(env._truncated).toBe(true);
  });

  it("does NOT mutate the caller's metadata object (pure instrumentation)", () => {
    const emitter = new CvdiagEmitter({ env: { NODE_ENV: "test" } });
    // A bag with a long (>64-char) string over the 2KB default cap: Step 1
    // clamps that string IN PLACE on the metadata object. If that object is
    // ALIASED to the caller's object, the caller's object is corrupted as a
    // side effect (the long string becomes "...61 chars...").
    const callerMeta: Record<string, unknown> = { note: "x".repeat(5000) };
    expect(serializedSize(callerMeta)).toBeGreaterThan(
      BYTE_CAP_BY_TIER.default,
    );
    const snapshot = JSON.parse(JSON.stringify(callerMeta));

    const envelope = emitter.emit({
      layer: "probe",
      boundary: "cvdiag.queue_dropped",
      slug: "cvdiag",
      demo: "cvdiag",
      outcome: "info",
      metadata: callerMeta,
    });

    expect(envelope).not.toBeNull();
    // The caller's object must be byte-for-byte unchanged after emit.
    expect(callerMeta).toEqual(snapshot);
  });

  it("size-drops (Step 3) the metadata bag without setting the PII _metadata_dropped signal", () => {
    const emitter = new CvdiagEmitter({ env: { NODE_ENV: "test" } });
    const cap = BYTE_CAP_BY_TIER.default; // 2KB

    // Scalar/short-string-heavy accounting bag: Step 1 + Step 2 cannot shrink it
    // enough (numbers + ≤8-char strings dominate), so Step 3 drops the bag.
    const metadata = scalarHeavyMetadata(200);
    expect(serializedSize(metadata)).toBeGreaterThan(cap);

    const envelope = emitter.emit({
      layer: "probe",
      boundary: "cvdiag.queue_dropped",
      slug: "cvdiag",
      demo: "cvdiag",
      outcome: "info",
      metadata,
    });

    expect(envelope).not.toBeNull();
    const env = envelope!;
    // Step 3 dropped the bag (it was un-shrinkable below cap by Steps 1-2).
    expect(env.metadata).toEqual({});
    expect(serializedSize(env)).toBeLessThanOrEqual(cap);
    // A SIZE drop is observable via _truncated...
    expect(env._truncated).toBe(true);
    // ...but must NOT pollute the §6 PII closed-world signal.
    expect(env._metadata_dropped).toBeUndefined();
  });

  it("still sets _metadata_dropped for a genuine PII key-drop (closed-world filter)", () => {
    const emitter = new CvdiagEmitter({ env: { NODE_ENV: "test" } });
    // A data-plane event with an unknown metadata key: validateMetadata drops
    // the unknown key and the emitter stamps the PII signal. This must remain
    // intact (guard against over-correcting Step 3).
    const envelope = emitter.emit({
      layer: "probe",
      boundary: "probe.message.send",
      slug: "langgraph-python",
      demo: "chat",
      outcome: "info",
      metadata: {
        message_index: 0,
        char_count: 3,
        demo: "chat",
        not_a_declared_key: "leak",
      },
    });
    expect(envelope).not.toBeNull();
    expect(envelope!._metadata_dropped).toBe(true);
  });

  it("stamps _truncated only when metadata/demo was actually clamped", () => {
    // With entry-bounding (boundEntryFields), slug/parent_span_id/test_id are
    // already valid+bounded, so the byte-cap's ONLY clampable fields are the
    // metadata bag and the free-text `demo`. The reachable trigger at the
    // default tier is an over-cap metadata bag (an entry-bounded ≤256-char
    // `demo` plus the bounded skeleton stays well under 2 KB on its own, so
    // demo-clamping is a defense-in-depth floor that does not fire here). The
    // ladder clamps/drops the metadata bag → `_truncated` is stamped because a
    // field was actually modified.
    const emitter = new CvdiagEmitter({ env: { NODE_ENV: "test" } });
    const env = emitter.emit({
      layer: "probe",
      boundary: "cvdiag.queue_dropped", // accounting rides metadata verbatim
      slug: "cvdiag",
      demo: "cvdiag",
      outcome: "info",
      metadata: scalarHeavyMetadata(200), // over cap → metadata clamped/dropped
    });
    expect(env).not.toBeNull();
    expect(env!._truncated).toBe(true);
    expect(env!.demo.length).toBeLessThanOrEqual(DEMO_MAX_LEN);
    expect(serializedSize(env!)).toBeLessThanOrEqual(BYTE_CAP_BY_TIER.default);
  });

  it("leaves an under-cap envelope untouched (no _truncated stamp)", () => {
    const emitter = new CvdiagEmitter({ env: { NODE_ENV: "test" } });
    const envelope = emitter.emit({
      layer: "probe",
      boundary: "cvdiag.queue_dropped",
      slug: "cvdiag",
      demo: "cvdiag",
      outcome: "info",
      metadata: { _dropped_count: 7 },
    });
    expect(envelope).not.toBeNull();
    expect(serializedSize(envelope!)).toBeLessThanOrEqual(
      BYTE_CAP_BY_TIER.default,
    );
    expect(envelope!._truncated).toBeUndefined();
  });
});

describe("CvdiagEmitter.applyByteCap — invariant matrix: size AND schema-validity (spec §6.3)", () => {
  // The durable R5-A3 guard. The redesigned byte-cap (§3.3) clamps ONLY the two
  // genuinely-unbounded inputs — the `metadata` bag and the free-text `demo`
  // string — and NEVER touches a format-constrained field (slug/ids/enums/
  // numbers/ts/edge_headers). This matrix asserts, FOR EVERY pathological cell,
  // BOTH halves of the post-condition simultaneously: (a) serializedSize <= cap,
  // and (b) every field remains schema-valid. The old size-only matrix could not
  // assert (b) because the prior ladder clamped slug/ids to fit cap (R5-A3).
  const slugPattern = /^[a-z][a-z0-9-]{0,63}$/;
  const spanPattern = /^[0-9a-f]{16}$/;

  function assertValid(env: CvdiagEnvelope, cap: number, name: string): void {
    expect(serializedSize(env), `${name}: size <= cap`).toBeLessThanOrEqual(
      cap,
    );
    expect(env.slug, `${name}: slug pattern`).toMatch(slugPattern);
    expect(env.span_id, `${name}: span_id pattern`).toMatch(spanPattern);
    expect(
      env.parent_span_id === null || spanPattern.test(env.parent_span_id),
      `${name}: parent_span_id 16-hex or null`,
    ).toBe(true);
    expect(env.trace_id, `${name}: trace_id === test_id`).toBe(env.test_id);
    expect(isValidTestId(env.test_id), `${name}: test_id valid UUIDv7`).toBe(
      true,
    );
    expect(["probe", "backend", "aimock"]).toContain(env.layer);
    expect(["ok", "err", "timeout", "info"]).toContain(env.outcome);
  }

  it("bounds every pathological shape AND keeps every field schema-valid", () => {
    const debugEnv = {
      NODE_ENV: "test",
      CVDIAG_DEBUG: "1",
      CVDIAG_DEBUG_ALLOW_LIST: "langgraph-python",
    };
    type Cell = {
      name: string;
      tier: "default" | "verbose" | "debug";
      env: Record<string, string | undefined>;
      build: (e: CvdiagEmitter) => CvdiagEnvelope | null;
    };
    const dp = (
      e: CvdiagEmitter,
      over: Partial<CvdiagEmitArgs>,
    ): CvdiagEnvelope | null =>
      e.emit({
        layer: "probe",
        boundary: "probe.message.send",
        slug: "langgraph-python",
        demo: "chat",
        outcome: "info",
        metadata: { message_index: 0, char_count: 3, demo: "chat" },
        ...over,
      } as CvdiagEmitArgs);

    const hugeEdge: EdgeHeaders = {
      "cf-ray": null,
      "cf-mitigated": null,
      "cf-cache-status": null,
      "x-railway-edge": null,
      "x-railway-request-id": null,
      "x-hikari-trace": null,
      "retry-after": null,
      via: "v".repeat(100 * 1024),
      server: null,
    };

    const cells: Cell[] = [];
    for (const tier of ["default", "verbose", "debug"] as const) {
      const env = tier === "debug" ? debugEnv : { NODE_ENV: "test" };
      cells.push(
        {
          name: `huge demo @${tier}`,
          tier,
          env,
          build: (e) => dp(e, { demo: "d".repeat(20000) }),
        },
        {
          name: `huge slug @${tier}`,
          tier,
          env,
          build: (e) => dp(e, { slug: "s".repeat(20000) }),
        },
        {
          name: `huge nested metadata @${tier}`,
          tier,
          env,
          build: (e) =>
            e.emit({
              layer: "probe",
              boundary: "cvdiag.queue_dropped",
              slug: "cvdiag",
              demo: "cvdiag",
              outcome: "info",
              metadata: { blob: { deeply: { nested: "x".repeat(20000) } } },
            }),
        },
        {
          name: `scalar-heavy bag @${tier}`,
          tier,
          env,
          build: (e) =>
            e.emit({
              layer: "probe",
              boundary: "cvdiag.queue_dropped",
              slug: "cvdiag",
              demo: "cvdiag",
              outcome: "info",
              metadata: scalarHeavyMetadata(400),
            }),
        },
        {
          name: `huge parent_span_id @${tier}`,
          tier,
          env,
          build: (e) => dp(e, { parentSpanId: "p".repeat(20000) }),
        },
        {
          name: `bigint metadata leaf @${tier}`,
          tier,
          env,
          build: (e) =>
            e.emit({
              layer: "probe",
              boundary: "cvdiag.queue_dropped",
              slug: "cvdiag",
              demo: "cvdiag",
              outcome: "info",
              metadata: { big: 9007199254740993n as unknown },
            }),
        },
        {
          name: `huge upstream edge-header @${tier}`,
          tier,
          env,
          build: (e) => dp(e, { edgeHeaders: hugeEdge }),
        },
      );
    }

    for (const c of cells) {
      const emitter = new CvdiagEmitter({ env: c.env });
      const cap = BYTE_CAP_BY_TIER[c.tier];
      const env = c.build(emitter);
      expect(env, `${c.name}: built`).not.toBeNull();
      assertValid(env!, cap, c.name);
    }
  });

  it("the huge-edge-header cell fits cap WITHOUT the ladder touching edge_headers", () => {
    const emitter = new CvdiagEmitter({ env: { NODE_ENV: "test" } });
    const hugeEdge: EdgeHeaders = {
      "cf-ray": null,
      "cf-mitigated": null,
      "cf-cache-status": null,
      "x-railway-edge": null,
      "x-railway-request-id": null,
      "x-hikari-trace": null,
      "retry-after": null,
      via: "v".repeat(100 * 1024),
      server: null,
    };
    const env = emitter.emit({
      layer: "probe",
      boundary: "probe.message.send",
      slug: "langgraph-python",
      demo: "chat",
      outcome: "info",
      edgeHeaders: hugeEdge,
      metadata: { message_index: 0, char_count: 3, demo: "chat" },
    });
    expect(env).not.toBeNull();
    // Edge value is entry-bounded to ≤256 (Task 5), NOT clamped by the ladder.
    expect(env!.edge_headers.via!.length).toBeLessThanOrEqual(256);
    expect(serializedSize(env!)).toBeLessThanOrEqual(BYTE_CAP_BY_TIER.default);
  });

  it("bounds an envelope with ALL 9 edge_headers at the entry-bound (ASCII + multi-byte) to the default tier cap", () => {
    // The entry-bound (EDGE_HEADER_MAX_LEN = 256) is a CHAR cap, not a BYTE
    // cap, and applies PER-VALUE. With all 9 keys populated near the char
    // bound, their summed byte length can exceed the 2048-byte default tier cap:
    //   - ASCII:      9 × 256 chars × 1 byte  ≈ 2304 envelope-payload bytes
    //   - multi-byte: 9 × 256 chars × 3 bytes ≈ 6912 envelope-payload bytes
    // Before the ladder clamps edge_headers, `applyByteCap` stamps `_truncated`
    // and returns over-cap — violating the post-condition. The ladder must
    // byte-clamp the edge-header VALUES (free strings, schema-valid) so
    // serializedSize <= cap for ANY header encoding, while the 9-key shape and
    // every format-constrained field stay schema-valid. (slugPattern/spanPattern
    // are reused from the enclosing describe scope.)
    const cap = BYTE_CAP_BY_TIER.default;

    const cases: Array<{ name: string; headers: EdgeHeaders }> = [
      // 256 ASCII chars per value → ~2304 bytes across 9 values (> 2048 cap).
      { name: "all-9 ASCII @256", headers: allEdgeHeaders("a".repeat(256)) },
      // 256 three-byte chars per value → ~6912 bytes across 9 values (>> cap).
      {
        name: "all-9 multi-byte @256",
        headers: allEdgeHeaders("★".repeat(256)),
      },
    ];

    for (const { name, headers } of cases) {
      const emitter = new CvdiagEmitter({ env: { NODE_ENV: "test" } });
      const env = emitter.emit({
        layer: "probe",
        boundary: "probe.message.send",
        slug: "langgraph-python",
        demo: "chat",
        outcome: "info",
        edgeHeaders: headers,
        metadata: { message_index: 0, char_count: 3, demo: "chat" },
      });
      expect(env, `${name}: built`).not.toBeNull();
      // (a) The whole serialized envelope fits the tier byte cap.
      expect(serializedSize(env!), `${name}: size <= cap`).toBeLessThanOrEqual(
        cap,
      );
      // (b) Every format-constrained field stays schema-valid — the ladder
      // clamps only the free-string edge-header VALUES, never the shape/ids.
      expect(env!.slug, `${name}: slug pattern`).toMatch(slugPattern);
      expect(env!.span_id, `${name}: span_id pattern`).toMatch(spanPattern);
      expect(env!.trace_id, `${name}: trace_id === test_id`).toBe(env!.test_id);
      expect(isValidTestId(env!.test_id), `${name}: test_id UUIDv7`).toBe(true);
      // (c) The closed 9-key edge_headers shape is preserved (values may be
      // byte-clamped to a short prefix or "" — never dropped to a missing key).
      expect(
        Object.keys(env!.edge_headers).sort(),
        `${name}: 9-key shape`,
      ).toEqual(
        [
          "cf-cache-status",
          "cf-mitigated",
          "cf-ray",
          "retry-after",
          "server",
          "via",
          "x-hikari-trace",
          "x-railway-edge",
          "x-railway-request-id",
        ].sort(),
      );
      // Trimming occurred → _truncated stamped.
      expect(env!._truncated, `${name}: _truncated`).toBe(true);
    }
  });
});

describe("CvdiagEmitter — nested metadata secret scrub (§6 deep)", () => {
  // The §6 PII guarantee must hold at EVERY depth of a surviving metadata
  // value, not just top-level strings. `backend.error.caught.stack_brief` is a
  // declared (allow-listed) key whose value is an array of objects — nested
  // string leaves there bypassed the old top-level-only scrub. A secret buried
  // in such a leaf must not appear anywhere in the enqueued envelope's JSON.
  it("redacts a secret buried in a nested array-of-objects metadata value", () => {
    const emitter = new CvdiagEmitter({ env: { NODE_ENV: "test" } });
    const secret = "Bearer sk-ant-api03-AbCd_Ef-0123456789xyzAB";
    const envelope = emitter.emit({
      layer: "backend",
      boundary: "backend.error.caught",
      slug: "langgraph-python",
      demo: "chat",
      outcome: "err",
      metadata: {
        exception_type: "AuthError",
        message_scrubbed: "auth failed",
        // Nested array-of-objects allow-listed value carrying a buried secret.
        stack_brief: [{ file: secret, line: 42 }],
      },
    });
    expect(envelope).not.toBeNull();
    const json = JSON.stringify(envelope);
    // No unredacted secret substring may survive anywhere in the serialization.
    expect(json).not.toContain("sk-ant-api03-AbCd_Ef-0123456789xyzAB");
    expect(json).not.toContain("0123456789xyzAB");
    expect(json).toContain("[REDACTED]");
    // Structure preserved: the non-string leaf (line) is untouched.
    const meta = envelope!.metadata as {
      stack_brief: Array<{ file: string; line: number }>;
    };
    expect(meta.stack_brief[0].line).toBe(42);
  });

  it("does not throw or hang on a self-referential (cyclic) metadata value", () => {
    const emitter = new CvdiagEmitter({ env: { NODE_ENV: "test" } });
    // A cyclic object as a nested value: the deep walker must not recurse
    // infinitely (WeakSet visited-guard) and emit() must not throw.
    const cyclic: Record<string, unknown> = { file: "ok", line: 1 };
    cyclic.self = cyclic;
    expect(() =>
      emitter.emit({
        layer: "backend",
        boundary: "backend.error.caught",
        slug: "langgraph-python",
        demo: "chat",
        outcome: "err",
        metadata: {
          exception_type: "AuthError",
          message_scrubbed: "x",
          stack_brief: cyclic as unknown as Array<{
            file: string;
            line: number;
          }>,
        },
      }),
    ).not.toThrow();
  });
});

describe("CvdiagEmitter.flush — queue_dropped accounting", () => {
  it("emits exactly one cvdiag.queue_dropped envelope carrying the drop count into the flushed batch", async () => {
    const pbWriter = new CapturingPbWriter();
    const emitter = new CvdiagEmitter({ pbWriter });

    // Overflow the bounded queue by `overflow` events so drop-oldest evicts
    // exactly `overflow` of them.
    const overflow = 7;
    emitN(emitter, QUEUE_CAP + overflow);

    // Queue is capped at QUEUE_CAP; `overflow` were dropped.
    expect(emitter.queueDepth()).toBe(QUEUE_CAP);

    await emitter.flush();

    expect(pbWriter.batches.length).toBe(1);
    const batch = pbWriter.batches[0];

    const accounting = batch.filter(
      (e) => e.boundary === "cvdiag.queue_dropped",
    );
    expect(accounting.length).toBe(1);
    expect(accounting[0].metadata["_dropped_count"]).toBe(overflow);

    // The accounting record must travel in the SAME batch as the data-plane
    // events it accounts for (it does not get stranded in the queue).
    expect(batch.length).toBe(QUEUE_CAP + 1);
    // Drop counter is cleared only because the event landed in the batch.
    expect(emitter.queueDepth()).toBe(0);
  });

  it("does NOT lose the drop count when the accounting envelope fails to construct (loss path)", async () => {
    const pbWriter = new CapturingPbWriter();
    const emitter = new CvdiagEmitter({ pbWriter });

    const overflow = 4;
    emitN(emitter, QUEUE_CAP + overflow);

    // Simulate the accounting envelope build failing (validateEnvelope failure
    // / thrown exception). The private builder is the single seam both emit()
    // and flush() route through; force it to return null only for the
    // accounting boundary so the data-plane drain is unaffected.
    const seam = emitter as unknown as {
      buildEnvelope: (...a: unknown[]) => CvdiagEnvelope | null;
    };
    const original = seam.buildEnvelope.bind(emitter);
    seam.buildEnvelope = (...args: unknown[]) => {
      const first = args[0] as { boundary?: string } | undefined;
      if (first?.boundary === "cvdiag.queue_dropped") return null;
      return original(...(args as Parameters<typeof original>));
    };

    await emitter.flush();

    // The accounting record could not be built, so it must NOT appear...
    const batch = pbWriter.batches[0] ?? [];
    expect(
      batch.filter((e) => e.boundary === "cvdiag.queue_dropped").length,
    ).toBe(0);

    // ...and crucially the drop count must be RETAINED (not silently zeroed),
    // so a subsequent successful flush still reports it.
    seam.buildEnvelope = original;
    await emitter.flush();
    const recovered = pbWriter.batches
      .flat()
      .filter((e) => e.boundary === "cvdiag.queue_dropped");
    expect(recovered.length).toBe(1);
    expect(recovered[0].metadata["_dropped_count"]).toBe(overflow);
  });

  it("emits nothing when there is neither a queued event nor a drop", async () => {
    const pbWriter = new CapturingPbWriter();
    const emitter = new CvdiagEmitter({ pbWriter });
    await emitter.flush();
    expect(pbWriter.batches.length).toBe(0);
  });
});

describe("CvdiagEmitter.flush — no PB writer configured", () => {
  it("leaves the queue intact when there is no PB writer (does NOT discard queued events)", async () => {
    // No pbWriter option → per the documented contract, events stay queued.
    const emitter = new CvdiagEmitter({});

    const count = 5;
    emitN(emitter, count);
    expect(emitter.queueDepth()).toBe(count);

    // flush() with no writer must be a no-op that preserves the queue.
    await emitter.flush();

    // BEFORE the fix this is 0 (the queue was spliced into `batch` and the
    // batch discarded on the early return) — RED. AFTER the fix the queue is
    // untouched — GREEN.
    expect(emitter.queueDepth()).toBe(count);
  });

  it("preserves droppedSinceFlush when there is no PB writer (drop accounting not reset)", async () => {
    const emitter = new CvdiagEmitter({});

    // Overflow the bounded queue so drop-oldest accrues `overflow` drops.
    const overflow = 3;
    emitN(emitter, QUEUE_CAP + overflow);
    expect(emitter.queueDepth()).toBe(QUEUE_CAP);

    const seam = emitter as unknown as { droppedSinceFlush: number };
    expect(seam.droppedSinceFlush).toBe(overflow);

    // flush() with no writer must NOT touch the drop counter.
    await emitter.flush();

    // BEFORE the fix the drop-accounting block ran and zeroed this — RED.
    // AFTER the fix it is preserved for the eventual writer-present flush.
    expect(seam.droppedSinceFlush).toBe(overflow);
    expect(emitter.queueDepth()).toBe(QUEUE_CAP);
  });
});

describe("cvdiag boundEntryFields — emit-entry field bounding (spec §3.1 / §6.5)", () => {
  const slugPattern = /^[a-z][a-z0-9-]{0,63}$/;

  it("sanitizes slug to the PB/codegen pattern ^[a-z][a-z0-9-]{0,63}$", () => {
    expect(
      boundEntryFields({ slug: "LangGraph-Python" } as never).slug,
    ).toMatch(slugPattern);
    expect(boundEntryFields({ slug: "9-leading-digit" } as never).slug).toMatch(
      slugPattern,
    );
    // A leading digit gets the `x` prefix, not stripped.
    expect(boundEntryFields({ slug: "9-leading-digit" } as never).slug).toBe(
      "x9-leading-digit",
    );
    expect(
      boundEntryFields({ slug: "has spaces & sym$bols" } as never).slug,
    ).toMatch(slugPattern);
    expect(
      boundEntryFields({ slug: "s".repeat(200) } as never).slug.length,
    ).toBeLessThanOrEqual(64);
    expect(boundEntryFields({ slug: "s".repeat(200) } as never).slug).toMatch(
      slugPattern,
    );
    expect(boundEntryFields({ slug: "" } as never).slug).toBe(SLUG_FALLBACK);
    expect(boundEntryFields({ slug: "###" } as never).slug).toBe(SLUG_FALLBACK);
    // Mixed-case + illegal chars normalize to a valid lowercase slug.
    expect(boundEntryFields({ slug: "Chat_Demo!!" } as never).slug).toBe(
      "chatdemo",
    );
  });

  it("hard-caps demo at DEMO_MAX_LEN with a trailing marker", () => {
    const out = boundEntryFields({
      slug: "ok",
      demo: "d".repeat(5000),
    } as never);
    expect(DEMO_MAX_LEN).toBe(256);
    expect(out.demo.length).toBeLessThanOrEqual(DEMO_MAX_LEN);
    expect(out.demo.endsWith("…")).toBe(true);
    expect(boundEntryFields({ slug: "ok", demo: "short" } as never).demo).toBe(
      "short",
    );
  });

  it("nulls an invalid parent_span_id, keeps a valid 16-hex one", () => {
    expect(
      boundEntryFields({ slug: "ok", parentSpanId: "zzzz" } as never)
        .parentSpanId,
    ).toBeNull();
    // A 5000-char value is nulled, NOT truncated to a non-16-hex prefix.
    expect(
      boundEntryFields({ slug: "ok", parentSpanId: "x".repeat(5000) } as never)
        .parentSpanId,
    ).toBeNull();
    expect(
      boundEntryFields({
        slug: "ok",
        parentSpanId: "0123456789abcdef",
      } as never).parentSpanId,
    ).toBe("0123456789abcdef");
    // Uppercase hex is NOT the lowercase contract → nulled.
    expect(
      boundEntryFields({
        slug: "ok",
        parentSpanId: "0123456789ABCDEF",
      } as never).parentSpanId,
    ).toBeNull();
    expect(boundEntryFields({ slug: "ok" } as never).parentSpanId).toBeNull();
  });

  it("ignores an invalid testId override and signals a re-mint", () => {
    // An invalid override must NOT be passed through; the emitter mints fresh.
    const out = boundEntryFields({
      slug: "ok",
      testId: "not-a-uuidv7",
    } as never);
    expect(out.testId === undefined || !isValidTestId(out.testId)).toBe(true);
    // A valid UUIDv7 override is preserved verbatim.
    const valid = "017f22e2-79b0-7cc3-98c4-dc0c0c07398f";
    expect(
      boundEntryFields({ slug: "ok", testId: valid } as never).testId,
    ).toBe(valid);
  });
});

describe("cvdiag emit — entry bound applied end-to-end (slug never violates contract)", () => {
  it("a 5000-char slug enqueues as a pattern-valid slug, NOT a clamped marker", () => {
    const emitter = new CvdiagEmitter({ env: { NODE_ENV: "test" } });
    const env = emitter.emit({
      layer: "probe",
      boundary: "probe.message.send",
      slug: "s".repeat(5000),
      demo: "chat",
      outcome: "info",
      metadata: { message_index: 0, char_count: 3, demo: "chat" },
    });
    expect(env).not.toBeNull();
    expect(env!.slug).toMatch(/^[a-z][a-z0-9-]{0,63}$/);
    expect(env!.slug).not.toContain("[clamped]");
    // trace_id mirrors test_id and both are valid UUIDv7.
    expect(env!.trace_id).toBe(env!.test_id);
    expect(isValidTestId(env!.test_id)).toBe(true);
  });

  it("a non-UUIDv7 testId override is ADOPTED as the cross-layer join key (not re-minted); trace_id still mirrors it", () => {
    // CHANGED CONTRACT (cross-layer join fix): a non-UUIDv7 `testId` is the
    // probe's per-run id forwarded as `x-test-id`. It is ADOPTED verbatim
    // (sanitized) as the join key — NOT replaced by a fresh mint, which would
    // break probe↔backend correlation. With no `traceId`, trace_id mirrors it.
    const emitter = new CvdiagEmitter({ env: { NODE_ENV: "test" } });
    const env = emitter.emit({
      layer: "probe",
      boundary: "probe.message.send",
      slug: "langgraph-python",
      demo: "chat",
      outcome: "info",
      testId: "not-a-uuidv7",
      metadata: { message_index: 0, char_count: 3, demo: "chat" },
    });
    expect(env).not.toBeNull();
    // Adopted verbatim (charset-clean already) — NOT a minted UUIDv7.
    expect(env!.test_id).toBe("not-a-uuidv7");
    expect(isValidTestId(env!.test_id)).toBe(false);
    expect(env!.trace_id).toBe(env!.test_id);
  });

  it("a fully-unsanitizable testId override falls back to a minted UUIDv7", () => {
    // When the inbound id has NO surviving charset chars (whitespace / control
    // only), there is no usable join key → mint a fresh UUIDv7 so the row is
    // still well-formed (the join is simply unavailable for that request).
    const emitter = new CvdiagEmitter({ env: { NODE_ENV: "test" } });
    const env = emitter.emit({
      layer: "probe",
      boundary: "probe.message.send",
      slug: "langgraph-python",
      demo: "chat",
      outcome: "info",
      testId: "  \n\t  ",
      metadata: { message_index: 0, char_count: 3, demo: "chat" },
    });
    expect(env).not.toBeNull();
    expect(isValidTestId(env!.test_id)).toBe(true);
    expect(env!.trace_id).toBe(env!.test_id);
  });
});

/**
 * Spec §6.1 nested-secret SWEEP — the durable cross-cutting guarantee that NO
 * planted secret survives at ANY depth of ANY data-plane boundary that carries
 * an array/object-valued metadata key (per `BOUNDARY_METADATA_KEYS`). The two
 * such boundaries with STRING leaves are:
 *   - `backend.error.caught`  → `stack_brief: { file: string, line: number }[]`
 *     (nested array-of-objects string leaves; default tier).
 *   - `aimock.match.decision` → `reject_reasons:
 *     { key, expected, actual }[]` (nested array-of-objects string leaves;
 *     emitted only at verbose+ tier, so the emitter is built verbose here —
 *     the SCRUB reaching the leaf is what is under test, not the tier filter).
 * (`probe.dom.alternate_content.child_type_histogram` is `Record<string,
 * number>` — an object with NUMERIC leaves only, so it has no string position a
 * secret could occupy; it is intentionally not part of the string-leaf sweep.)
 *
 * For each, a sentinel secret is planted in EVERY string position — top-level
 * `message_scrubbed` AND every nested array/object leaf — and the assertion is
 * that the sentinel substring (and its high-entropy tail) appears NOWHERE in
 * `JSON.stringify(enqueuedEnvelope)`, with `[REDACTED]` present.
 */
/**
 * A deliberately-SHALLOW scrub used only by the meaningfulness demonstration:
 * scrubs top-level string values but copies nested arrays/objects through
 * UNSCRUBBED (the historical top-level-only failure mode `scrubDeep` replaced).
 * Module-scope to satisfy `consistent-function-scoping` (mirrors the
 * `numberLeaf`/`voidLeaf` helpers in scrub.test.ts).
 */
function shallowScrub(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    out[key] = typeof value === "string" ? scrubSecrets(value) : value;
  }
  return out;
}

describe("CVDIAG §6.1 nested-sweep — no secret survives at any depth across boundaries", () => {
  // A canonical Anthropic-shaped key: base64url body with a contiguous ≥12-char
  // alnum entropy run, so the bounded SK_KEY_REGEX redacts the WHOLE key.
  const SENTINEL = "Bearer sk-ant-api03-AbC_dEf-0123456789sentinelXYZ";
  // The high-entropy fragment that must never survive even partially.
  const SENTINEL_ENTROPY = "0123456789sentinelXYZ";

  /** Assert the planted sentinel is scrubbed everywhere in the envelope JSON. */
  function assertNoSentinel(env: CvdiagEnvelope | null, name: string): void {
    expect(env, `${name}: envelope built`).not.toBeNull();
    const json = JSON.stringify(env);
    expect(json, `${name}: full sentinel gone`).not.toContain(SENTINEL);
    expect(json, `${name}: sk- prefix gone`).not.toContain("sk-ant-api03");
    expect(json, `${name}: entropy tail gone`).not.toContain(SENTINEL_ENTROPY);
    expect(json, `${name}: redaction marker present`).toContain("[REDACTED]");
  }

  it("backend.error.caught: sentinel planted in stack_brief[].file nested leaves never survives (default tier)", () => {
    const emitter = new CvdiagEmitter({ env: { NODE_ENV: "test" } });
    const env = emitter.emit({
      layer: "backend",
      boundary: "backend.error.caught",
      slug: "langgraph-python",
      demo: "chat",
      outcome: "err",
      metadata: {
        exception_type: "AuthError",
        // Top-level string position.
        message_scrubbed: `auth failed: ${SENTINEL}`,
        // Nested array-of-objects string-leaf positions.
        stack_brief: [
          { file: SENTINEL, line: 1 },
          { file: `at handler (${SENTINEL})`, line: 2 },
          { file: `${SENTINEL}:42`, line: 3 },
        ] as never,
      },
    });
    assertNoSentinel(env, "backend.error.caught");
    // Positive: the nested leaf was actually scrubbed (not merely dropped).
    const survivor = env!.metadata.stack_brief as Array<{ file: string }>;
    expect(survivor[0].file).toContain("[REDACTED]");
    expect(survivor[1].file).toContain("[REDACTED]");
    expect(survivor[2].file).toContain("[REDACTED]");
  });

  it("aimock.match.decision: sentinel planted in reject_reasons[].{expected,actual} nested leaves never survives (verbose tier)", () => {
    // aimock.match.decision is default:false → emit at verbose tier so the row
    // is produced; the SCRUB reaching the nested leaf is what is under test.
    const emitter = new CvdiagEmitter({
      env: { NODE_ENV: "test", CVDIAG_VERBOSE: "1" },
    });
    const env = emitter.emit({
      layer: "aimock",
      boundary: "aimock.match.decision",
      slug: "langgraph-python",
      demo: "chat",
      outcome: "info",
      metadata: {
        fixture_id: "fixture-abc-1",
        match_score: 0.5,
        // Nested array-of-objects string-leaf positions (every string filled).
        reject_reasons: [
          { key: "authorization", expected: SENTINEL, actual: SENTINEL },
          {
            key: `hdr ${SENTINEL}`,
            expected: `want ${SENTINEL}`,
            actual: `got ${SENTINEL}`,
          },
        ] as never,
      },
    });
    assertNoSentinel(env, "aimock.match.decision");
    // Positive: the nested leaves were actually scrubbed.
    const reasons = env!.metadata.reject_reasons as Array<{
      key: string;
      expected: string;
      actual: string;
    }>;
    expect(reasons[0].expected).toContain("[REDACTED]");
    expect(reasons[0].actual).toContain("[REDACTED]");
    expect(reasons[1].key).toContain("[REDACTED]");
    expect(reasons[1].expected).toContain("[REDACTED]");
    expect(reasons[1].actual).toContain("[REDACTED]");
  });

  it("MEANINGFULNESS DEMO: a deliberately-shallow (top-level-only) scrub LEAVES the nested sentinel — the sweep would catch a regression", () => {
    // The production nested-scrub (scrubDeep) is already integrated, so the
    // emit-level sweep is GREEN on current code. To prove the sweep is a
    // meaningful guard (would go RED if scrubDeep ever regressed to a
    // top-level-only scrub), demonstrate that a SHALLOW scrub — scrubbing only
    // top-level string values, copying nested containers verbatim — leaves the
    // nested sentinel intact. This is the RED half: the assertion the emit-level
    // sweep makes (JSON has no sentinel) WOULD FAIL under a shallow scrub.
    const metadata = {
      exception_type: "AuthError",
      message_scrubbed: `auth failed: ${SENTINEL}`,
      stack_brief: [{ file: SENTINEL, line: 1 }],
    };
    const shallow = shallowScrub(metadata);
    const shallowJson = JSON.stringify(shallow);
    // RED demonstration: under a shallow scrub the nested sentinel SURVIVES.
    expect(shallowJson).toContain(SENTINEL);
    expect(shallowJson).toContain(SENTINEL_ENTROPY);
    // ...yet the top-level value WAS scrubbed (proving the secret is real and
    // scrubbable — only the DEPTH of the walk was the gap).
    expect(shallow.message_scrubbed as string).toContain("[REDACTED]");

    // GREEN: the real production deep scrub (what emit uses) removes it at depth.
    const emitter = new CvdiagEmitter({ env: { NODE_ENV: "test" } });
    const env = emitter.emit({
      layer: "backend",
      boundary: "backend.error.caught",
      slug: "langgraph-python",
      demo: "chat",
      outcome: "err",
      metadata,
    });
    assertNoSentinel(env, "deep-scrub GREEN");
  });
});

describe("CvdiagEmitter — DEBUG prod fail-closed (safe-env allow-list, §6)", () => {
  // A valid opt-in allow-list is always present so the ONLY thing under test is
  // the env-label gate. DEBUG must be REFUSED (constructor throws) for any
  // production-like, aliased, padded, or unrecognized env label — and PERMITTED
  // only for an explicit known-non-prod label. This is the fail-open regression
  // guard: a whitespace-padded ("production\n") or aliased ("prod"/"live") prod
  // label, or any unknown label, must NOT be allowed to arm DEBUG.
  const ALLOW = "langgraph-python";
  const mk =
    (env: Record<string, string | undefined>): (() => CvdiagEmitter) =>
    () =>
      new CvdiagEmitter({
        debug: true,
        env: { CVDIAG_DEBUG_ALLOW_LIST: ALLOW, ...env },
      });

  // Each REFUSED case sets the label via SHOWCASE_ENV (the highest-precedence
  // source) so the test exercises the resolved label exactly. The unset/"" case
  // omits all three sources entirely (label resolves to null → unknown → prod).
  const refused: Array<[string, Record<string, string | undefined>]> = [
    ["production", { SHOWCASE_ENV: "production" }],
    ["production\\n (newline-padded)", { SHOWCASE_ENV: "production\n" }],
    ["' production ' (space-padded)", { SHOWCASE_ENV: " production " }],
    ["prod (alias)", { SHOWCASE_ENV: "prod" }],
    ["production-us (prod-prefixed)", { SHOWCASE_ENV: "production-us" }],
    ["live (alias)", { SHOWCASE_ENV: "live" }],
    ["someunknownlabel (unrecognized)", { SHOWCASE_ENV: "someunknownlabel" }],
    ["unset (no env source resolves)", {}],
    ['"" (empty SHOWCASE_ENV)', { SHOWCASE_ENV: "" }],
  ];

  for (const [name, env] of refused) {
    it(`REFUSES DEBUG (fail-closed) for env=${name}`, () => {
      expect(mk(env)).toThrow(/CVDIAG_DEBUG refused/);
    });
  }

  // Known-non-prod labels in the safe-env allow-list: DEBUG is PERMITTED. The
  // safe set covers the showcase's real non-prod envs ("staging" on Railway,
  // "development"/"test" locally/CI).
  const allowed: Array<[string, Record<string, string | undefined>]> = [
    ["staging", { SHOWCASE_ENV: "staging" }],
    ["development", { SHOWCASE_ENV: "development" }],
    ["test", { SHOWCASE_ENV: "test" }],
    ["local", { SHOWCASE_ENV: "local" }],
    ["STAGING (case-insensitive)", { SHOWCASE_ENV: "STAGING" }],
    ["' staging ' (padded safe label)", { SHOWCASE_ENV: " staging " }],
  ];

  for (const [name, env] of allowed) {
    it(`PERMITS DEBUG for known-non-prod env=${name}`, () => {
      const emitter = mk(env)();
      expect(emitter.tier).toBe("debug");
    });
  }

  it("still REQUIRES the opt-in allow-list even on a safe env", () => {
    expect(
      () =>
        new CvdiagEmitter({ debug: true, env: { SHOWCASE_ENV: "staging" } }),
    ).toThrow(/CVDIAG_DEBUG_ALLOW_LIST is required/);
  });
});

/**
 * Cross-layer JOIN-KEY adoption (spec §5 `test_id` = the single id that joins
 * one run's rows across all layers). The backend receives the probe's per-run
 * `x-test-id` (e.g. `d4-<slug>-<runId>` — NOT a UUIDv7) and MUST stamp it as
 * the envelope `test_id` so probe↔backend rows join on the same key. The
 * backend's OWN per-request id is the `trace_id`/`span_id` (per-request), which
 * is decoupled from `test_id` on the adoption path.
 *
 * RED before the fix:
 *   - a non-UUIDv7 `testId` override was DROPPED by `boundEntryFields` and a
 *     fresh random UUIDv7 was minted → backend `test_id` ≠ the probe's id →
 *     join impossible.
 *   - `trace_id` was hard-mirrored to `test_id`, so there was no way to carry a
 *     distinct backend per-request id.
 */
describe("CvdiagEmitter cross-layer test_id adoption + trace_id decoupling", () => {
  const mkEmitter = (): {
    emitter: CvdiagEmitter;
    captured: CvdiagEnvelope[];
  } => {
    const captured: CvdiagEnvelope[] = [];
    // Verbose tier so backend.request.ingress / llm.call.start (default:false)
    // pass the §6 tier matrix and the adoption assertion is not masked by the
    // tier filter.
    const emitter = new CvdiagEmitter({
      layer: "backend",
      verbose: true,
      env: { NODE_ENV: "test" },
      pbWriter: {
        async writeBatch(events) {
          captured.push(...events);
        },
      },
    });
    return { emitter, captured };
  };

  it("adopts a non-UUIDv7 inbound testId as the envelope test_id (the cross-layer join key)", () => {
    const { emitter } = mkEmitter();
    const inbound = "d4-langgraph-typescript-run42";
    const env = emitter.emit({
      layer: "backend",
      boundary: "backend.request.ingress",
      slug: "langgraph-typescript",
      demo: "langgraph-typescript",
      outcome: "info",
      testId: inbound,
      metadata: { method: "POST", path: "/api", content_length: 2 },
    });
    expect(env).not.toBeNull();
    // The inbound id is adopted verbatim (sanitized) — NOT replaced by a mint.
    expect(env!.test_id).toBe(inbound);
  });

  it("keeps trace_id decoupled from test_id when a distinct traceId is supplied", () => {
    const { emitter } = mkEmitter();
    const inbound = "d6-mastra-abc";
    const backendTrace = mintTestId(); // backend's own per-request UUIDv7
    const env = emitter.emit({
      layer: "backend",
      boundary: "backend.agent.enter",
      slug: "mastra",
      demo: "mastra",
      outcome: "info",
      testId: inbound,
      traceId: backendTrace,
      metadata: { agent_name: "default", model_id: "x" },
    });
    expect(env).not.toBeNull();
    // test_id = the cross-layer join key (probe's id); trace_id = backend's own.
    expect(env!.test_id).toBe(inbound);
    expect(env!.trace_id).toBe(backendTrace);
    expect(env!.trace_id).not.toBe(env!.test_id);
  });

  it("still mirrors trace_id to test_id when no traceId is supplied (back-compat: probe path)", () => {
    const { emitter } = mkEmitter();
    const probeUuid = mintTestId();
    const env = emitter.emit({
      layer: "probe",
      boundary: "probe.message.send",
      slug: "langgraph-typescript",
      demo: "chat",
      outcome: "info",
      testId: probeUuid,
      metadata: { message_index: 0, char_count: 1, demo: "chat" },
    });
    expect(env).not.toBeNull();
    expect(env!.test_id).toBe(probeUuid);
    // Probe passes no traceId → trace_id mirrors test_id (existing invariant).
    expect(env!.trace_id).toBe(probeUuid);
  });

  it("sanitizes a malformed/oversize inbound testId rather than dropping it", () => {
    const { emitter } = mkEmitter();
    // Control chars + whitespace + over-length: must be bounded to a safe
    // free-text key (never dropped → minted, which would break the join).
    const dirty = `  d4-evil\n${"z".repeat(300)}   `;
    const env = emitter.emit({
      layer: "backend",
      boundary: "backend.request.ingress",
      slug: "built-in-agent",
      demo: "built-in-agent",
      outcome: "info",
      testId: dirty,
      metadata: { method: "POST", path: "/", content_length: 0 },
    });
    expect(env).not.toBeNull();
    // No control chars / newlines / NULs leaked into the join key.
    expect(env!.test_id).not.toMatch(/[\s ]/);
    // Bounded length (≤128) and non-empty.
    expect(env!.test_id.length).toBeGreaterThan(0);
    expect(env!.test_id.length).toBeLessThanOrEqual(128);
    // Derived deterministically from the dirty input prefix (so probe+backend
    // applying the SAME sanitizer land on the SAME join key).
    expect(env!.test_id.startsWith("d4-evil")).toBe(true);
  });
});
