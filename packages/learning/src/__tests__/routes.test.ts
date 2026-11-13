import { describe, expect, it } from "vitest";
import { toOriginAndRoute, toRoute } from "../routes";

describe("raw URLs", () => {
  it("retains ID-like and encoded path segments even with legacy templates", () => {
    const path = "/users/jane@example.com/orders/123/search/private%20search";
    expect(toRoute(path, ["/users/:id/orders/:order/search/:query"])).toBe(
      path,
    );
    expect(toRoute("/")).toBe("/");
  });

  it("preserves the full URL and resolves relative URLs", () => {
    expect(
      toOriginAndRoute(
        "/deals/9?token=synthetic#details",
        ["/deals/:id"],
        "https://app.example.com/x",
      ),
    ).toEqual({
      url: "https://app.example.com/deals/9?token=synthetic#details",
      origin: "https://app.example.com",
      route: "/deals/9",
    });
  });
});
