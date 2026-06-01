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

  it("falls back to the raw URL string in the title when the URL cannot be parsed", () => {
    const action = defaultMapToAction(
      { ...captured, url: "not://a real url" },
      true,
    );

    // Title still produced with the raw url segment — title generation never throws.
    expect(action.title?.startsWith("POST ")).toBe(true);
  });

  it("preserves the full url (including query string) in metadata.url", () => {
    const action = defaultMapToAction(captured, true);

    // The query string is part of the recorded url so the writer agent can
    // see GET-style parameters that are part of the action's identity.
    expect(action.metadata).toMatchObject({
      url: "https://app.test/api/orders/123/refund?ref=1",
    });
  });
});
