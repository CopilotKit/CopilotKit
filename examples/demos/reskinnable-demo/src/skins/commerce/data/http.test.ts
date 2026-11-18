import { afterEach, describe, expect, it, vi } from "vitest";
import { errorResponse, requireAmount } from "./http";
import {
  JUSTIFICATION_MAX_LENGTH,
  JUSTIFICATION_MIN_LENGTH,
} from "./waiver-codes";

/**
 * The route error mapper. These assertions exist because the failure mode they
 * pin is INVISIBLE: the lookup key is a thrown Error's `message`, so an Error
 * whose message happened to name an `Object.prototype` member used to resolve
 * truthy through the prototype chain, take the "known code" branch with no
 * `status`, and answer **200** — a failed mutation reported to the agent and to
 * the page as a success, with nothing in the server log. It still compiled, and
 * every route kept rendering.
 */
describe("commerce errorResponse", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const silenceLog = () =>
    vi.spyOn(console, "error").mockImplementation(() => {});

  it("maps a known code to its status and symptom-only message", async () => {
    const res = errorResponse(
      new Error("BELOW_MARGIN_FLOOR"),
      "POST promotions/[id]/approve",
    );
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "BELOW_MARGIN_FLOOR",
      message: "Discounted margin falls below the category floor.",
    });
  });

  // Beat 5's validation codes have to reach the caller as 400s. Left unmapped
  // they would fall through to the logged 500 below, which reads as "our bug"
  // rather than "you sent a template we do not send".
  it.each([
    ["UNKNOWN_TEMPLATE", "That is not a message template we send."],
    ["ACTOR_NAME_TOO_LONG", "That name is longer than the record accepts."],
    ["NOTE_TOO_LONG", "That note is longer than the record accepts."],
  ])("maps %s to a 400", async (code, message) => {
    const res = errorResponse(new Error(code), "POST orders/[id]/notify");
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: code, message });
  });

  it("maps a refused justification to a 422 that names the bounds", async () => {
    // Safe to be specific here — the bounds are about the TEXT, so unlike
    // BELOW_MARGIN_FLOOR this message cannot leak which codes justify.
    const res = errorResponse(
      new Error("INVALID_JUSTIFICATION"),
      "POST margin-waivers",
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("INVALID_JUSTIFICATION");
    expect(body.message).toContain(String(JUSTIFICATION_MIN_LENGTH));
    expect(body.message).toContain(String(JUSTIFICATION_MAX_LENGTH));
    expect(body.message).not.toMatch(/code|VENDOR-FUND|justifying/i);
  });

  // Every code the order state machine can raise has to be MAPPED. An unmapped
  // one is not a harmless 500: `holdOrder` reports the status back to the
  // agent, so a refused-but-unmapped transition reads as a server fault to
  // retry rather than a rule to respect.
  it.each([
    ["ORDER_ALREADY_SETTLED", 409],
    ["ILLEGAL_ORDER_TRANSITION", 409],
    ["EXCEPTION_ON_SETTLED_ORDER", 422],
  ])("maps the order-state refusal %s to %i", async (code, status) => {
    const log = silenceLog();
    const res = errorResponse(new Error(code), "PATCH orders/[id]");
    expect(res.status).toBe(status);
    await expect(res.json()).resolves.toMatchObject({ error: code });
    // Mapped, therefore never logged as an internal fault.
    expect(log).not.toHaveBeenCalled();
  });

  // The regression. `"toString"`, `"constructor"`, `"valueOf"` and
  // `"__proto__"` are all inherited members of a plain object literal; each one
  // used to be treated as a mapped code and answered 200.
  it.each([
    "toString",
    "constructor",
    "valueOf",
    "hasOwnProperty",
    "__proto__",
  ])("does not treat the inherited key %s as a known code", async (message) => {
    const log = silenceLog();
    const res = errorResponse(new Error(message), "PATCH orders/[id]");
    expect(res.status).toBe(500);
    expect(res.status).not.toBeLessThan(300); // never a 2xx
    await expect(res.json()).resolves.toEqual({
      error: "INTERNAL_ERROR",
      message: "Something went wrong on our side.",
    });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("maps an unrecognised code to a logged 500, not a retryable 400", async () => {
    const log = silenceLog();
    const boom = new Error("SOMETHING_NOBODY_MAPPED");
    const res = errorResponse(boom, "POST plans");
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: "INTERNAL_ERROR",
      message: "Something went wrong on our side.",
    });
    expect(log).toHaveBeenCalledWith("[commerce/api] POST plans", boom);
  });

  // The map-absence guard. The integrity codes belong in the unrecognised
  // branch: a mapped code gets a status and a bespoke message and is NEVER
  // logged, which is precisely the treatment a dangling reference must not get.
  // Adding either code to `CODES` turns this red.
  it.each(["DANGLING_PRODUCT_REF", "DANGLING_PROMOTION_REF"])(
    "leaves the integrity code %s unmapped, so it stays a logged 500",
    async (code) => {
      const log = silenceLog();
      const res = errorResponse(
        new Error(code),
        "POST promotions/[id]/approve",
      );
      expect(res.status).toBe(500);
      // Not a 404, and not a bespoke message the agent could narrate as a rule
      // of the domain.
      await expect(res.json()).resolves.toEqual({
        error: "INTERNAL_ERROR",
        message: "Something went wrong on our side.",
      });
      expect(log).toHaveBeenCalledTimes(1);
    },
  );

  it("maps a non-Error throw to the same logged 500", async () => {
    const log = silenceLog();
    const res = errorResponse("not an error at all", "POST orders/[id]/notes");
    expect(res.status).toBe(500);
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe("commerce requireAmount", () => {
  it("passes a real JSON number through untouched", () => {
    expect(requireAmount(85)).toBe(85);
    expect(requireAmount(85.5)).toBe(85.5);
  });

  // `true` and `"12"` are the money bug: `Number()` turned them into 1 and 12,
  // both of which satisfy every rule `issueRefund` has and settled the return.
  it.each([true, false, "12", "", [], null, undefined, {}, 1e999])(
    "refuses %o rather than coercing it to a figure",
    (value) => {
      expect(() => requireAmount(value)).toThrow("INVALID_AMOUNT");
    },
  );

  // Deliberate: the domain range is single-sourced in `store.issueRefund` so the
  // ceiling holds however a refund is issued. If someone adds `<= 0` here, one
  // rule now lives in two files — delete it there first, or not at all.
  it("leaves the domain range to the store", () => {
    expect(requireAmount(-5)).toBe(-5);
    expect(requireAmount(0)).toBe(0);
    expect(requireAmount(9_999_999_999)).toBe(9_999_999_999);
  });
});
