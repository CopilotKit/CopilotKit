import { describe, expect, it } from "vitest";
import {
  describeTarget,
  isSensitive,
  parsePrefixes,
  safeRequestUrl,
} from "./privacy";

describe("privacy boundaries", () => {
  it.each([
    '<input type="password">',
    '<input type="hidden">',
    '<input autocomplete="cc-number">',
    '<input autocomplete="shipping street-address">',
    '<input name="accessToken">',
    "<div data-sensitive><button>Save</button></div>",
    '<div data-private="false"><button>Save</button></div>',
    '<div data-copilotkit-learning="ignore"><button>Save</button></div>',
    '<div class="ph-no-capture"><button>Save</button></div>',
    '<input type="email">',
    '<input id="customerPhone">',
  ])("excludes sensitive markup: %s", (html) => {
    document.body.innerHTML = html;
    expect(isSensitive(document.querySelector("button,input")!)).toBe(true);
  });

  it("honors private ancestors across shadow roots", () => {
    const host = document.createElement("div");
    host.dataset.private = "";
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = "<button>Save</button>";
    expect(isSensitive(shadow.querySelector("button")!)).toBe(true);
  });

  it("supports disabling accessible names and never reads values, raw text or DOM IDs", () => {
    document.body.innerHTML =
      '<button id="customer-123" aria-label="Save draft">Personal text</button>';
    expect(describeTarget(document.querySelector("button")!, false)).toEqual({
      tagName: "button",
      role: "button",
    });
    expect(
      describeTarget(document.querySelector("button")!, true).accessibleName,
    ).toBe("Save draft");
    document
      .querySelector("button")!
      .setAttribute("aria-label", "alice@example.com");
    expect(
      describeTarget(document.querySelector("button")!, true).accessibleName,
    ).toBeUndefined();
  });

  it("enriches with explicit labels, control names and app-authored learning identifiers", () => {
    document.body.innerHTML =
      '<button name="approve" data-learning-id="expense-approve" title="Approve expense">Private document contents</button>';
    expect(describeTarget(document.querySelector("button")!, true)).toEqual({
      tagName: "button",
      role: "button",
      accessibleName: "Approve expense",
      name: "approve",
      learningId: "expense-approve",
    });
  });

  it.each([
    "alice@example.com",
    "1234 5678",
    "+1 (555) 123-4567",
    "https://private.example/path",
    "www.private.example",
    "Access token",
    "Password reset",
    "a".repeat(81),
  ])("filters private metadata: %s", (value) => {
    const button = document.createElement("button");
    button.setAttribute("aria-label", value);
    button.setAttribute("data-learning-id", value);
    expect(describeTarget(button, true)).toEqual({
      tagName: "button",
      role: "button",
    });
  });

  it("matches route boundaries and preserves filtered endpoint paths", () => {
    const base = "https://app.example.com/page";
    const allowed = parsePrefixes(
      ["/api", "/api/orders", "https://service.example.com/v1"],
      base,
    );
    const excluded = parsePrefixes(["/api/copilotkit"], base);
    expect(
      safeRequestUrl(
        "/api/orders/alice@example.com?token=secret#private",
        base,
        allowed,
        excluded,
      ),
    ).toBe("https://app.example.com/api/orders/:redacted");
    expect(
      safeRequestUrl("/api/copilotkit/agent/run", base, allowed, excluded),
    ).toBeUndefined();
    expect(
      safeRequestUrl("/api-other", base, allowed, excluded),
    ).toBeUndefined();
    expect(
      safeRequestUrl(
        "https://analytics.example.com/api/events",
        base,
        allowed,
        excluded,
      ),
    ).toBeUndefined();
    expect(
      safeRequestUrl(
        "https://service.example.com/v1/customer/123",
        base,
        allowed,
        excluded,
      ),
    ).toBe("https://service.example.com/v1/customer/:redacted");
    expect(
      safeRequestUrl(
        "https://user:password@app.example.com/api",
        base,
        allowed,
        excluded,
      ),
    ).toBeUndefined();
    expect(
      parsePrefixes(
        ["data:private", "::::bad", "https://user:password@example.com/api"],
        base,
      ).every((url) => url.origin === "https://app.example.com"),
    ).toBe(true);
  });

  it.each(["summary", "submit", "preview"])(
    "retains the %s endpoint while excluding request query, hash and identifiers",
    (endpoint) => {
      const base = "https://app.example.com/";
      expect(
        safeRequestUrl(
          `/api/dispatch/drafts/12345/${endpoint}?email=alice@example.com#private`,
          base,
          parsePrefixes(["/api"], base),
          [],
        ),
      ).toBe(
        `https://app.example.com/api/dispatch/drafts/:redacted/${endpoint}`,
      );
    },
  );

  it.each([
    "alice%40example.com",
    "alice%2540example.com",
    "api_key=short",
    "550e8400-e29b-41d4-a716-446655440000",
    "%252540",
    "%broken",
  ])(
    "uses the page privacy filter for encoded/sensitive segment %s",
    (segment) => {
      const base = "https://app.example.com/";
      expect(
        safeRequestUrl(
          `/api/orders/${segment}/summary`,
          base,
          parsePrefixes(["/api"], base),
          [],
        ),
      ).toBe("https://app.example.com/api/orders/:redacted/summary");
    },
  );

  it("falls back only to a filtered allowed prefix for oversized paths", () => {
    const base = "https://app.example.com/";
    expect(
      safeRequestUrl(
        `/api/orders/${"x".repeat(1100)}alice@example.com`,
        base,
        parsePrefixes(["/api", "/api/orders"], base),
        [],
      ),
    ).toBe("https://app.example.com/api/orders");
    expect(
      safeRequestUrl(
        `/api/alice@example.com/${"x".repeat(1100)}`,
        base,
        parsePrefixes(["/api/alice@example.com"], base),
        [],
      ),
    ).toBe("https://app.example.com/api/:redacted");
    const oversized = `/api/${"x".repeat(1100)}`;
    expect(
      safeRequestUrl(oversized, base, parsePrefixes([oversized], base), []),
    ).toBeUndefined();
  });
});
