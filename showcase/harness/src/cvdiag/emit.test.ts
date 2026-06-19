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
} from "./emit.js";
import type { CvdiagPbWriter } from "./emit.js";
import { isValidTestId } from "./schema.js";
import type { CvdiagEnvelope } from "./schema.js";

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

  it("bytecap invariant: bounds EVERY pathological envelope shape to its tier cap (matrix/property)", () => {
    // The durable convergence lever. `applyByteCap` claims a HARD guarantee that
    // the enqueued envelope's serialized size never exceeds the tier cap — but
    // the only fields it trimmed were `metadata`. Caller-supplied FIXED string
    // fields (`slug`, `demo`, `parent_span_id`, `trace_id`) are also unbounded
    // by the caller, so a 5000-char `slug`/`demo` enqueues far over cap while
    // stamped `_truncated: true` as if bounded. This matrix asserts the actual
    // post-condition for ALL such shapes.
    type Case = {
      name: string;
      tier: "default" | "verbose" | "debug";
      env: Record<string, string | undefined>;
      // Data-plane boundary with a huge FIXED field (slug/demo) — reaches
      // applyByteCap via a normal data-plane emit. Metadata is small/legal.
      dataPlane?: {
        slug: string;
        demo: string;
        parentSpanId?: string | null;
      };
      // Accounting boundary that rides a huge/heavy metadata bag verbatim —
      // reaches applyByteCap via the accounting (cvdiag.*) path.
      accountingMetadata?: Record<string, unknown>;
    };

    const debugEnv = {
      NODE_ENV: "test",
      CVDIAG_DEBUG: "1",
      CVDIAG_DEBUG_ALLOW_LIST: "langgraph-python",
    };

    const cases: Case[] = [
      {
        name: "huge slug (5000 chars), default tier",
        tier: "default",
        env: { NODE_ENV: "test" },
        dataPlane: {
          slug: "s".repeat(5000),
          demo: "chat",
        },
      },
      {
        name: "huge demo (5000 chars), default tier",
        tier: "default",
        env: { NODE_ENV: "test" },
        dataPlane: {
          slug: "langgraph-python",
          demo: "d".repeat(5000),
        },
      },
      {
        name: "huge parent_span_id, default tier",
        tier: "default",
        env: { NODE_ENV: "test" },
        dataPlane: {
          slug: "langgraph-python",
          demo: "chat",
          parentSpanId: "p".repeat(5000),
        },
      },
      {
        name: "huge slug AND demo AND parent_span_id, default tier",
        tier: "default",
        env: { NODE_ENV: "test" },
        dataPlane: {
          slug: "s".repeat(5000),
          demo: "d".repeat(5000),
          parentSpanId: "p".repeat(5000),
        },
      },
      {
        name: "huge slug + heavy metadata bag, debug tier",
        tier: "debug",
        env: debugEnv,
        dataPlane: {
          slug: "s".repeat(20000),
          demo: "d".repeat(20000),
        },
      },
      {
        name: "huge nested metadata, accounting, default tier",
        tier: "default",
        env: { NODE_ENV: "test" },
        accountingMetadata: { blob: { deeply: { nested: "x".repeat(5000) } } },
      },
      {
        name: "scalar-heavy metadata bag, accounting, default tier",
        tier: "default",
        env: { NODE_ENV: "test" },
        accountingMetadata: scalarHeavyMetadata(200),
      },
    ];

    for (const c of cases) {
      const emitter = new CvdiagEmitter({ env: c.env });
      const cap = BYTE_CAP_BY_TIER[c.tier];

      let envelope: CvdiagEnvelope | null;
      if (c.dataPlane) {
        envelope = emitter.emit({
          layer: "probe",
          boundary: "probe.message.send", // default: true → emitted at all tiers
          slug: c.dataPlane.slug,
          demo: c.dataPlane.demo,
          outcome: "info",
          parentSpanId: c.dataPlane.parentSpanId ?? null,
          metadata: { message_index: 0, char_count: 3, demo: "chat" },
        });
      } else {
        envelope = emitter.emit({
          layer: "probe",
          boundary: "cvdiag.queue_dropped",
          slug: "cvdiag",
          demo: "cvdiag",
          outcome: "info",
          metadata: c.accountingMetadata,
        });
      }

      expect(envelope, `${c.name}: envelope built`).not.toBeNull();
      const env = envelope!;
      // THE INVARIANT: the whole serialized envelope fits the tier cap, for
      // EVERY pathological shape.
      expect(
        serializedSize(env),
        `${c.name}: serializedSize ${serializedSize(env)} must be <= cap ${cap}`,
      ).toBeLessThanOrEqual(cap);
    }
  });

  it("a 5000-char slug is entry-bounded to a pattern-valid slug, under cap, NOT byte-cap-clamped", () => {
    // OBSOLETED by entry-bounding (Task 5b): this test previously fed a
    // 5000-char `slug` and asserted `applyByteCap` Step 4 clamped it to a
    // `…[clamped]` marker with `_truncated: true`. With `boundEntryFields` the
    // slug is sanitized to the PB/codegen contract `^[a-z][a-z0-9-]{0,63}$` AT
    // EMIT ENTRY, so the envelope is already under the default cap and the
    // byte-cap never has to touch a format-constrained field. Rewritten to
    // expect the entry-bounded valid slug (NOT weakened — the assertion is
    // stronger: a pattern-valid slug, not just a size-bounded marker).
    const emitter = new CvdiagEmitter({ env: { NODE_ENV: "test" } });
    const envelope = emitter.emit({
      layer: "probe",
      boundary: "probe.message.send",
      slug: "s".repeat(5000),
      demo: "chat",
      outcome: "info",
      metadata: { message_index: 0, char_count: 3, demo: "chat" },
    });
    expect(envelope).not.toBeNull();
    // Slug is the entry-bounded valid slug, not a byte-cap `[clamped]` marker.
    expect(envelope!.slug).toMatch(/^[a-z][a-z0-9-]{0,63}$/);
    expect(envelope!.slug).not.toContain("[clamped]");
    // Already under cap from entry-bounding → no byte-cap trim → no flag.
    expect(serializedSize(envelope!)).toBeLessThanOrEqual(
      BYTE_CAP_BY_TIER.default,
    );
    expect(envelope!._truncated).toBeUndefined();
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

  it("an invalid testId override is re-minted and trace_id mirrors it", () => {
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
    expect(isValidTestId(env!.test_id)).toBe(true);
    expect(env!.trace_id).toBe(env!.test_id);
  });
});
