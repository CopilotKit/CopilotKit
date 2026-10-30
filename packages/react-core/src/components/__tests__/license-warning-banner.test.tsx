import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LicenseWarningBanner } from "../license-warning-banner";

/** Renders the banner and returns its message text. */
function bannerMessage(
  props: React.ComponentProps<typeof LicenseWarningBanner>,
) {
  render(<LicenseWarningBanner {...props} />);
  return screen.getByText(/CopilotKit license/).textContent;
}

describe("LicenseWarningBanner text", () => {
  it("says the license expires soon when the day count is not known", () => {
    expect(bannerMessage({ type: "expiring" })).toBe(
      "Your CopilotKit license expires soon. Please renew.",
    );
  });

  it.each([
    [1, "Your CopilotKit license expires in 1 day. Please renew."],
    [3, "Your CopilotKit license expires in 3 days. Please renew."],
  ])("counts %i day(s) left before expiry", (graceRemaining, expected) => {
    expect(bannerMessage({ type: "expiring", graceRemaining })).toBe(expected);
  });

  it("names the expiry date when it is known", () => {
    expect(bannerMessage({ type: "expired", expiryDate: "2026-01-31" })).toBe(
      "Your CopilotKit license expired on 2026-01-31. Please renew at copilotkit.ai/pricing",
    );
  });

  it("leaves the date out when it is not known", () => {
    expect(bannerMessage({ type: "expired" })).toBe(
      "Your CopilotKit license expired. Please renew at copilotkit.ai/pricing",
    );
  });
});
