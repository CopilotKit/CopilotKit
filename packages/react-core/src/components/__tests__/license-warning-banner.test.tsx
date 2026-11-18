import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  InlineFeatureWarning,
  LicenseWarningBanner,
} from "../license-warning-banner";
import { CopilotChatConfigurationProvider } from "../../providers/CopilotChatConfigurationProvider";

// The banner text rules are covered next to core's ɵgetLicenseBannerSpec.
describe("LicenseWarningBanner", () => {
  it("shows the core spec's text and link", () => {
    render(<LicenseWarningBanner type="expiring" graceRemaining={3} />);

    expect(
      screen.getByText(
        "Your CopilotKit license expires in 3 days. Please renew.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Renew" }).getAttribute("href"),
    ).toBe("https://dashboard.operations.copilotkit.ai");
  });

  it("uses the configured chat labels", () => {
    render(
      <CopilotChatConfigurationProvider
        labels={{ licenseInvalidText: "Token ungültig" }}
      >
        <LicenseWarningBanner type="invalid" />
      </CopilotChatConfigurationProvider>,
    );

    expect(screen.getByText("Token ungültig")).toBeTruthy();
  });

  it("publishes the bottom offset while it shows", () => {
    const root = document.documentElement;
    const { unmount } = render(<LicenseWarningBanner type="no_license" />);
    expect(
      root.style.getPropertyValue("--copilotkit-license-banner-offset"),
    ).toBe("52px");

    unmount();

    expect(
      root.style.getPropertyValue("--copilotkit-license-banner-offset"),
    ).toBe("");
  });
});

describe("InlineFeatureWarning", () => {
  it("uses the configured feature-unlicensed label", () => {
    render(
      <CopilotChatConfigurationProvider
        labels={{
          licenseFeatureUnlicensedText: "{feature} braucht eine Lizenz.",
        }}
      >
        <InlineFeatureWarning featureName="Chat" />
      </CopilotChatConfigurationProvider>,
    );

    expect(screen.getByText(/Chat braucht eine Lizenz\./)).toBeTruthy();
  });
});
