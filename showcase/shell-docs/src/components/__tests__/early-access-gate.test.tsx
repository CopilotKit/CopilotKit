import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EarlyAccessGate } from "../early-access-gate";
import { EARLY_ACCESS_GATES, getEarlyAccessGate } from "@/lib/early-access";

describe("early-access config", () => {
  it("registers the slack gate with the shared password", () => {
    expect(EARLY_ACCESS_GATES.slack.password).toBe("earlyaccess");
    expect(EARLY_ACCESS_GATES.slack.storageKey).toBe(
      "shell-docs-early-access:slack",
    );
  });

  it("points the request-access CTA at the beyond-the-web form", () => {
    expect(EARLY_ACCESS_GATES.slack.requestUrl).toBe(
      "https://go.copilotkit.ai/beyond-the-web-form",
    );
  });

  it("resolves known ids and rejects unknown ones", () => {
    expect(getEarlyAccessGate("slack")).toBe(EARLY_ACCESS_GATES.slack);
    expect(getEarlyAccessGate("nope")).toBeNull();
    expect(getEarlyAccessGate(undefined)).toBeNull();
  });
});

describe("EarlyAccessGate", () => {
  it("server-renders gated content blurred, inert, and hidden from AT", () => {
    const markup = renderToStaticMarkup(
      <EarlyAccessGate gate="slack">
        <p>secret slack guide</p>
      </EarlyAccessGate>,
    );

    // Content stays in the DOM (it's what gets blurred)…
    expect(markup).toContain("secret slack guide");
    // …but is visually blurred and unreachable.
    expect(markup).toContain("blur-");
    expect(markup).toContain("inert=");
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("pointer-events-none");
  });

  it("does not server-render the unlock card (it mounts client-side)", () => {
    const markup = renderToStaticMarkup(
      <EarlyAccessGate gate="slack">
        <p>secret slack guide</p>
      </EarlyAccessGate>,
    );

    expect(markup).not.toContain("Enter password");
    expect(markup).not.toContain("Unlock");
  });

  it("passes children through untouched for unknown gate ids", () => {
    const markup = renderToStaticMarkup(
      <EarlyAccessGate gate="not-a-gate">
        <p>plain content</p>
      </EarlyAccessGate>,
    );

    expect(markup).toBe("<p>plain content</p>");
  });
});
