import { describe, it, expect, vi } from "vitest";
import { createRequestHandler } from "./server.js";
import { UnauthorizedError } from "./auth.js";

describe("createRequestHandler", () => {
  it("returns 401 when verification fails", async () => {
    const verifier = { verify: vi.fn(async () => { throw new UnauthorizedError("bad"); }) };
    const onEvent = vi.fn(async () => ({}));
    const handler = createRequestHandler({ verifier, onEvent });
    const res = await handler({ headers: { authorization: "Bearer x" }, body: { type: "MESSAGE" } });
    expect(res.status).toBe(401);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("verifies then dispatches and returns 200 with the event result", async () => {
    const verifier = { verify: vi.fn(async () => {}) };
    const onEvent = vi.fn(async () => ({ text: "sync-reply" }));
    const handler = createRequestHandler({ verifier, onEvent });
    const res = await handler({ headers: { authorization: "Bearer ok" }, body: { type: "MESSAGE" } });
    expect(verifier.verify).toHaveBeenCalledWith("Bearer ok");
    expect(res).toEqual({ status: 200, body: { text: "sync-reply" } });
  });
});
