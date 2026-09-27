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

  it("matches route boundaries and emits only the most specific configured prefix", () => {
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
    ).toBe("https://app.example.com/api/orders");
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
    ).toBe("https://service.example.com/v1");
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
});
