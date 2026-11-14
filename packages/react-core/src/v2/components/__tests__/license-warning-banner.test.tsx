import { render, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { LicenseWarningBanner } from "../license-warning-banner";

describe("LicenseWarningBanner expiring", () => {
  afterEach(cleanup);

  it("omits the day count when graceRemaining is unknown", () => {
    const { container } = render(<LicenseWarningBanner type="expiring" />);
    expect(container.textContent).toContain(
      "Your CopilotKit license is expiring. Please renew.",
    );
    expect(container.textContent).not.toContain("undefined");
  });

  it("shows the day count when graceRemaining is known", () => {
    const { container } = render(
      <LicenseWarningBanner type="expiring" graceRemaining={3} />,
    );
    expect(container.textContent).toContain(
      "Your CopilotKit license expires in 3 days. Please renew.",
    );
  });

  it("uses the singular for one day", () => {
    const { container } = render(
      <LicenseWarningBanner type="expiring" graceRemaining={1} />,
    );
    expect(container.textContent).toContain("expires in 1 day.");
  });
});
