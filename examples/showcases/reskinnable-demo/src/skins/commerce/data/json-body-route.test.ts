import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH as patchOrder } from "@/app/api/commerce/v1/orders/[id]/route";
import { POST as postNote } from "@/app/api/commerce/v1/orders/[id]/notes/route";
import { POST as postRefund } from "@/app/api/commerce/v1/returns/[id]/refund/route";
import * as store from "./store";

/**
 * The two failure domains of a write route, kept apart.
 *
 * `await req.json()` used to sit INSIDE the same `try` that wrapped the store
 * call, so a truncated or non-JSON body threw a `SyntaxError` into
 * `errorResponse`, which — correctly, and deliberately — treats an unrecognised
 * code as a logged 500. The result was that "the caller sent bytes we cannot
 * parse" and "our own ledger is broken" arrived as the SAME response with the
 * SAME log line, and neither line said which record the request was about.
 *
 * These assertions pin the split from both sides, because fixing one side alone
 * is how this regresses: a malformed body has to be a deliberate 400 that NAMES
 * the record and is NOT logged as an internal fault, and a genuine store fault
 * has to keep its 500 AND its `console.error`. The `errorResponse` contract
 * itself is untouched — see `http.test.ts`, which pins that an unrecognised code
 * is still a 500.
 */

const ORDER = "ord-4471"; // seeded `open` with a fraud-review exception
const APPROVED_RETURN = "ret-2210"; // seeded `approved`, itemValue 340

/** A body that is not JSON at all, sent the way a real caller would send it. */
const unreadable = (url: string, method: string) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: "{ this is not json",
  });

const json = (url: string, method: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const order = () => store.orders().find((o) => o.id === ORDER);
const ret = () => store.returns().find((r) => r.id === APPROVED_RETURN);

beforeEach(() => store.reset());
afterEach(() => vi.restoreAllMocks());

describe("PATCH orders/[id] — an unreadable body", () => {
  it("answers a deliberate 400 that names the order, and writes nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await patchOrder(
      unreadable(`/api/commerce/v1/orders/${ORDER}`, "PATCH"),
      params(ORDER),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("MALFORMED_BODY");
    // The id is in the response, not merely in the log: the tools report the
    // message straight back into the transcript.
    expect(body.message).toContain(ORDER);

    // Warned (a caller mistake worth seeing), never console.error'd (not ours).
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(`id=${ORDER}`);
    expect(error).not.toHaveBeenCalled();

    // Untouched: the order is still exactly as seeded.
    expect(order()?.status).toBe("open");
    expect(order()?.exception).toBe("fraud-review");
  });

  it("keeps a genuine store fault a LOGGED 500 naming the order", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(store, "setOrderStatus").mockImplementation(() => {
      throw new Error("KABOOM_NOBODY_MAPPED");
    });

    const res = await patchOrder(
      json(`/api/commerce/v1/orders/${ORDER}`, "PATCH", { status: "on-hold" }),
      params(ORDER),
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: "INTERNAL_ERROR",
      message: "Something went wrong on our side.",
    });
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain(`id=${ORDER}`);
  });

  it("still holds the order on a well-formed body", async () => {
    const res = await patchOrder(
      json(`/api/commerce/v1/orders/${ORDER}`, "PATCH", { status: "on-hold" }),
      params(ORDER),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      id: ORDER,
      status: "on-hold",
    });
    expect(order()?.status).toBe("on-hold");
  });

  // The vocabulary and presence 400s are a DIFFERENT refusal and must not have
  // been folded into the parse one: they keep their own code and log nothing.
  it.each([
    ["an empty PATCH", {}],
    ["an unknown status", { status: "teleported" }],
    ["an unknown exception", { exception: "" }],
  ])("still answers BAD_REQUEST for %s", async (_label, sent) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await patchOrder(
      json(`/api/commerce/v1/orders/${ORDER}`, "PATCH", sent),
      params(ORDER),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "BAD_REQUEST" });
    expect(warn).not.toHaveBeenCalled();
    expect(order()?.status).toBe("open");
  });

  // A top-level non-object parses fine — it just carries no fields — so it is
  // the presence check's business, not the parser's.
  it.each([["a number", 5] as const, ["a string", '"nope"'] as const])(
    "treats %s body as fields-absent rather than unparseable",
    async (_label, raw) => {
      const res = await patchOrder(
        new NextRequest(`http://localhost/api/commerce/v1/orders/${ORDER}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: String(raw),
        }),
        params(ORDER),
      );
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        error: "BAD_REQUEST",
      });
    },
  );
});

describe("POST returns/[id]/refund — an unreadable body", () => {
  it("answers a 400 naming the return WITHOUT settling it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await postRefund(
      unreadable(`/api/commerce/v1/returns/${APPROVED_RETURN}/refund`, "POST"),
      params(APPROVED_RETURN),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "MALFORMED_BODY",
      message: `That request body is not readable JSON (record ${APPROVED_RETURN}).`,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();

    // The point of the route: nothing settled, so the money did not move.
    expect(ret()?.status).toBe("approved");
    expect(ret()?.refundAmount).toBeNull();
  });

  it("keeps a genuine store fault a LOGGED 500 naming the return", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(store, "issueRefund").mockImplementation(() => {
      throw new Error("KABOOM_NOBODY_MAPPED");
    });

    const res = await postRefund(
      json(`/api/commerce/v1/returns/${APPROVED_RETURN}/refund`, "POST", {
        amount: 85.5,
      }),
      params(APPROVED_RETURN),
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      error: "INTERNAL_ERROR",
    });
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain(`id=${APPROVED_RETURN}`);
  });

  // The amount gate is the other half of the same body decode and still answers
  // 422 rather than being swallowed by the parse 400 above.
  it("still refuses a coercible amount with INVALID_AMOUNT", async () => {
    const res = await postRefund(
      json(`/api/commerce/v1/returns/${APPROVED_RETURN}/refund`, "POST", {
        amount: true,
      }),
      params(APPROVED_RETURN),
    );
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      error: "INVALID_AMOUNT",
    });
    expect(ret()?.status).toBe("approved");
  });

  it("still refunds a legitimate amount", async () => {
    const res = await postRefund(
      json(`/api/commerce/v1/returns/${APPROVED_RETURN}/refund`, "POST", {
        amount: 85.5,
      }),
      params(APPROVED_RETURN),
    );
    expect(res.status).toBe(200);
    expect(ret()?.status).toBe("refunded");
    expect(ret()?.refundAmount).toBe(85.5);
  });
});

// A third route, cheaply: the class was fixed in five places and a per-route
// copy is exactly the kind of thing that gets one of them wrong.
describe("POST orders/[id]/notes — an unreadable body", () => {
  it("answers a 400 naming the order and posts no note", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = order()?.notes.length ?? 0;

    const res = await postNote(
      unreadable(`/api/commerce/v1/orders/${ORDER}/notes`, "POST"),
      params(ORDER),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "MALFORMED_BODY",
    });
    expect(String(warn.mock.calls[0]?.[0])).toContain(`id=${ORDER}`);
    expect(order()?.notes).toHaveLength(before);
  });

  it("still posts a well-formed note", async () => {
    const before = order()?.notes.length ?? 0;
    const res = await postNote(
      json(`/api/commerce/v1/orders/${ORDER}/notes`, "POST", {
        text: "🚨 Held for fraud review.",
        author: "Wren Adeyemi",
      }),
      params(ORDER),
    );
    expect(res.status).toBe(201);
    expect(order()?.notes).toHaveLength(before + 1);
  });
});
