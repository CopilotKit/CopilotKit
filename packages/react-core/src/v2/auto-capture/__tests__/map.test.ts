import { describe, expect, it } from "vitest";
import { defaultMapToAction } from "../map";
import type { CapturedRequest } from "../types";

const captured: CapturedRequest = {
  method: "POST",
  url: "https://app.test/api/orders/123/refund?ref=1",
  requestBody: { reason: "damaged" },
  status: 200,
  responseBody: { ok: true },
  durationMs: 42,
};

describe("defaultMapToAction", () => {
  it("derives a mechanical title from method + pathname", () => {
    const action = defaultMapToAction(captured, true);

    expect(action.title).toBe("POST /api/orders/123/refund");
  });

  it("puts the request body in newData and request meta in metadata", () => {
    const action = defaultMapToAction(captured, true);

    expect(action.newData).toEqual({ reason: "damaged" });
    expect(action.metadata).toEqual({
      url: "https://app.test/api/orders/123/refund?ref=1",
      status: 200,
      durationMs: 42,
      responseBody: { ok: true },
    });
  });

  it("omits the response body when capture is disabled", () => {
    const action = defaultMapToAction(captured, false);

    expect(action.metadata).not.toHaveProperty("responseBody");
  });

  it("omits the response body when there is none", () => {
    const action = defaultMapToAction(
      { ...captured, responseBody: undefined },
      true,
    );

    expect(action.metadata).not.toHaveProperty("responseBody");
  });
});
