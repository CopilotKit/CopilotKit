import { describe, expect, it } from "vitest";
import { toOriginAndRoute, toRoute } from "../routes";

describe("toRoute", () => {
  it("returns the matching template", () => {
    expect(toRoute("/deals/42/notes", ["/deals/:dealId/notes"])).toBe(
      "/deals/:dealId/notes",
    );
  });

  it("masks ID-like segments when no template matches", () => {
    expect(
      toRoute(
        "/users/123/files/550e8400-e29b-41d4-a716-446655440000/a1b2c3d4e5f6a7b8",
      ),
    ).toBe("/users/:id/files/:id/:id");
  });

  it("masks long random tokens but keeps readable slugs", () => {
    expect(toRoute("/invite/Xk9pQ2rT7vLm3nB8wZ4c/settings")).toBe(
      "/invite/:id/settings",
    );
    expect(toRoute("/team/members")).toBe("/team/members");
  });

  it("returns / for the root path", () => {
    expect(toRoute("/")).toBe("/");
  });
});

describe("toOriginAndRoute", () => {
  it("drops the query string and hash and keeps the origin", () => {
    expect(
      toOriginAndRoute("https://api.example.com/orders/77?token=secret#top"),
    ).toEqual({ origin: "https://api.example.com", route: "/orders/:id" });
  });

  it("resolves a relative URL against the base", () => {
    expect(
      toOriginAndRoute("/deals/9", ["/deals/:id"], "https://app.example.com/x"),
    ).toEqual({ origin: "https://app.example.com", route: "/deals/:id" });
  });
});
