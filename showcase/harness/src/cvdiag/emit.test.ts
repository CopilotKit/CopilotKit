/**
 * emit.test.ts — `CvdiagEmitter` byte-cap enforcement (spec §7 R5-F3).
 *
 * Focus: `applyByteCap` must bound the WHOLE serialized envelope to the tier
 * byte cap, not merely stamp `_truncated: true`. An over-cap envelope whose
 * excess comes from many short-string / numeric metadata values (each ≤64
 * chars, so the legacy >64-char/object trim pass never touches them) must
 * STILL be brought under cap before enqueue — otherwise the contract "the
 * whole serialized envelope must fit the tier byte cap" is violable.
 *
 * Accounting (`cvdiag.*`) boundaries carry their metadata bag verbatim (no
 * closed-world filter), so they are the cleanest over-cap trigger that
 * survives validateMetadata and validateEnvelope.
 */

import { describe, expect, it } from "vitest";

import { BYTE_CAP_BY_TIER, CvdiagEmitter } from "./emit.js";

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
