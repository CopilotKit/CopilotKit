import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EarlyAccessGate } from "../early-access-gate";
import { EARLY_ACCESS_GATES, getEarlyAccessGate } from "@/lib/early-access";

describe("early-access config", () => {
  it("has no active product gates and rejects unknown ids", () => {
    expect(EARLY_ACCESS_GATES).toEqual({});
    expect(getEarlyAccessGate("whatsapp")).toBeNull();
    expect(getEarlyAccessGate("slack")).toBeNull();
    expect(getEarlyAccessGate("teams")).toBeNull();
    expect(getEarlyAccessGate("nope")).toBeNull();
    expect(getEarlyAccessGate(undefined)).toBeNull();
  });
});

describe("EarlyAccessGate", () => {
  it("passes children through untouched when no gate is registered", () => {
    const markup = renderToStaticMarkup(
      <EarlyAccessGate gate="whatsapp">
        <p>plain content</p>
      </EarlyAccessGate>,
    );

    expect(markup).toBe("<p>plain content</p>");
  });
});
