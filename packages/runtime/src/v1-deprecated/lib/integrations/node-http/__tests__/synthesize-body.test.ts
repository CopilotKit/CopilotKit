import { describe, expect, it } from "vitest";
import { synthesizeBodyFromParsedBody } from "../request-handler";

describe("synthesizeBodyFromParsedBody", () => {
  it("keeps the client's content type on a parsed object", () => {
    const headers = new Headers({
      "content-type": "application/x-www-form-urlencoded",
    });

    expect(synthesizeBodyFromParsedBody({ a: 1 }, headers).contentType).toBe(
      "application/x-www-form-urlencoded",
    );
  });

  it("falls back to JSON when the client sent no content type", () => {
    expect(
      synthesizeBodyFromParsedBody({ a: 1 }, new Headers()).contentType,
    ).toBe("application/json");
  });
});
