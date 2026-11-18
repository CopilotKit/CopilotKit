import { describe, it, expect } from "vitest";
import { pageToRoute, PAGE_ROUTES, PAGE_KEYS } from "./navigation";

describe("pageToRoute", () => {
  it("maps the dashboard to the home route", () => {
    expect(pageToRoute("dashboard")).toBe("/");
  });

  it("maps each known page to its route", () => {
    expect(pageToRoute("pipeline")).toBe("/pipeline");
    expect(pageToRoute("products")).toBe("/products");
    expect(pageToRoute("accounts")).toBe("/accounts");
    expect(pageToRoute("contacts")).toBe("/contacts");
    expect(pageToRoute("team")).toBe("/team");
    expect(pageToRoute("reports")).toBe("/reports");
    expect(pageToRoute("activity")).toBe("/activity");
  });

  it("falls back to the dashboard for an unknown page", () => {
    expect(pageToRoute("nope")).toBe("/");
    expect(pageToRoute("")).toBe("/");
  });
});

describe("PAGE_KEYS", () => {
  it("lists exactly the keys of PAGE_ROUTES", () => {
    expect([...PAGE_KEYS].sort()).toEqual(Object.keys(PAGE_ROUTES).sort());
  });

  it("every key resolves to a defined, non-empty route", () => {
    for (const key of PAGE_KEYS) {
      expect(typeof pageToRoute(key)).toBe("string");
      expect(pageToRoute(key).startsWith("/")).toBe(true);
    }
  });
});
