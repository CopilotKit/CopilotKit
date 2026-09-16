import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Verifies stable `data-testid` markers exist on the error banner surfaces
 * (BannerErrorDisplay + UsageBanner) so e2e tests can deterministically
 * distinguish "errored out" vs "still loading" states. Without these, e2e
 * probes hit ~30-60s timeouts instead of failing fast.
 */

const toastProviderPath = resolve(__dirname, "toast-provider.tsx");
const usageBannerPath = resolve(__dirname, "../usage-banner.tsx");

const toastProviderSrc = readFileSync(toastProviderPath, "utf-8");
const usageBannerSrc = readFileSync(usageBannerPath, "utf-8");

describe("react-core stable testids", () => {
  it("BannerErrorDisplay renders the copilot-error-banner testid", () => {
    expect(toastProviderSrc).toMatch(/data-testid="copilot-error-banner"/);
  });

  it("UsageBanner renders the copilot-error-banner testid", () => {
    expect(usageBannerSrc).toMatch(/data-testid="copilot-error-banner"/);
  });
});
