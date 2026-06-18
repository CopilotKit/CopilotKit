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

import { BYTE_CAP_BY_TIER, CvdiagEmitter, QUEUE_CAP } from "./emit.js";
import type { CvdiagPbWriter } from "./emit.js";
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
