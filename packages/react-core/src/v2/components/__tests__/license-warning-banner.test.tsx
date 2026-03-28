import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import {
  LicenseWarningBanner,
  InlineFeatureWarning,
} from "../license-warning-banner";

describe("LicenseWarningBanner", () => {
  it("renders 'Powered by CopilotKit' for no_license type", () => {
    render(<LicenseWarningBanner type="no_license" />);
    expect(screen.getByText("Powered by CopilotKit")).toBeTruthy();
  });

  it("renders feature name for feature_unlicensed type", () => {
    render(
      <LicenseWarningBanner type="feature_unlicensed" featureName="Chat" />,
    );
    expect(
      screen.getByText(/Chat.*requires a CopilotKit license/),
    ).toBeTruthy();
  });

  it("renders expiry warning with days remaining", () => {
    render(<LicenseWarningBanner type="expiring" graceRemaining={3} />);
    expect(screen.getByText(/expires in 3 days/)).toBeTruthy();
  });

  it("renders critical expired banner", () => {
    render(<LicenseWarningBanner type="expired" expiryDate="2026-03-01" />);
    expect(screen.getByText(/expired/i)).toBeTruthy();
  });

  it("renders invalid license banner", () => {
    render(<LicenseWarningBanner type="invalid" />);
    expect(screen.getByText(/Invalid CopilotKit license/)).toBeTruthy();
  });
});

describe("InlineFeatureWarning", () => {
  it("renders with feature name and pricing link", () => {
    render(<InlineFeatureWarning featureName="Agents" />);
    expect(screen.getByText(/requires a CopilotKit license/)).toBeTruthy();
    expect(screen.getByRole("link")).toBeTruthy();
  });
});
