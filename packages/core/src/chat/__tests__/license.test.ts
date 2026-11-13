import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  LicenseContextValue,
  RuntimeEntitlementResponse,
  RuntimeLicenseStatus,
} from "@copilotkit/shared";
import {
  ɵgetInlineFeatureWarningSpec,
  ɵgetLicenseBannerSpec,
  ɵreserveLicenseBannerOffset,
  ɵresolveLicenseState,
  ɵresolveThreadsLicense,
  type ɵThreadsLicenseRuntime,
} from "../license";
import { CopilotChatDefaultLabels } from "../labels";
import { CopilotKitCoreRuntimeConnectionStatus } from "../../core/core";

/** Runtime info for a runtime whose `/info` has not answered yet. */
const CONNECTING_RUNTIME: ɵThreadsLicenseRuntime = {
  status: CopilotKitCoreRuntimeConnectionStatus.Connecting,
  licenseStatus: undefined,
  runtimeEntitlements: undefined,
};

/** Runtime info for a connected runtime. */
function connectedRuntime(
  licenseStatus?: RuntimeLicenseStatus,
): ɵThreadsLicenseRuntime {
  return {
    status: CopilotKitCoreRuntimeConnectionStatus.Connected,
    licenseStatus,
    runtimeEntitlements: undefined,
  };
}

function failedEntitlements(retryable: boolean): RuntimeEntitlementResponse {
  return {
    status: retryable ? "unavailable" : "misconfigured",
    error: {
      code: retryable
        ? "runtime_entitlements_unavailable"
        : "runtime_entitlements_misconfigured",
      message: "Runtime entitlement lookup failed",
      retryable,
    },
  };
}

function managedEntitlements(active: boolean): RuntimeEntitlementResponse {
  return {
    status: "ready",
    entitlement: {
      active,
      source: "managedOrgSubscription",
      features: {},
      limits: active ? { "threads.max_count": 200 } : {},
    },
  };
}

function licenseContext(
  status: RuntimeLicenseStatus | null,
  threadsGranted: boolean,
): LicenseContextValue {
  return {
    status,
    license: null,
    checkFeature: (feature) => feature !== "threads" || threadsGranted,
    getLimit: () => null,
  };
}

describe("ɵresolveLicenseState banner", () => {
  it.each([
    { status: "none", publicKey: undefined, bannerType: "no_license" },
    { status: "none", publicKey: "ck_pub_123", bannerType: null },
    { status: "expired", publicKey: undefined, bannerType: "expired" },
    { status: "invalid", publicKey: undefined, bannerType: "invalid" },
    { status: "expiring", publicKey: "ck_pub_123", bannerType: "expiring" },
    { status: "valid", publicKey: undefined, bannerType: null },
    { status: "unknown", publicKey: undefined, bannerType: null },
    { status: undefined, publicKey: undefined, bannerType: null },
  ] as const)(
    "status $status with key $publicKey shows banner $bannerType",
    ({ status, publicKey, bannerType }) => {
      const state = ɵresolveLicenseState({
        status,
        retryPending: false,
        publicKey,
      });
      expect(state.bannerType).toBe(bannerType);
      expect(state.warningStatus).toBe(status);
    },
  );

  it("keeps the context status null before the runtime reports", () => {
    const state = ɵresolveLicenseState({ retryPending: false });
    expect(state.context.status).toBeNull();
    expect(state.context.checkFeature("chat")).toBe(true);
  });

  it("bases the banner on the resolved entitlement status, not the legacy status", () => {
    const state = ɵresolveLicenseState({
      status: "valid",
      entitlements: managedEntitlements(false),
      retryPending: false,
    });
    expect(state.context.status).toBe("none");
    expect(state.bannerType).toBe("no_license");
  });
});

describe("ɵresolveLicenseState retryable entitlement failure", () => {
  it.each([
    {
      name: "hides the status while the retry runs",
      status: "none",
      retryPending: true,
      contextStatus: null,
      warningStatus: undefined,
      bannerType: null,
    },
    {
      name: "keeps a valid legacy status during the retry",
      status: "valid",
      retryPending: true,
      contextStatus: "valid",
      warningStatus: "valid",
      bannerType: null,
    },
    {
      name: "keeps an expiring legacy status during the retry",
      status: "expiring",
      retryPending: true,
      contextStatus: "expiring",
      warningStatus: "expiring",
      bannerType: "expiring",
    },
    {
      name: "reports unknown after the retry ends",
      status: "unknown",
      retryPending: false,
      contextStatus: "unknown",
      warningStatus: "unknown",
      bannerType: null,
    },
    {
      name: "shows the reported banner after the retry ends",
      status: "expired",
      retryPending: false,
      contextStatus: "expired",
      warningStatus: "expired",
      bannerType: "expired",
    },
  ] as const)(
    "$name",
    ({ status, retryPending, contextStatus, warningStatus, bannerType }) => {
      const state = ɵresolveLicenseState({
        status,
        entitlements: failedEntitlements(true),
        retryPending,
      });
      expect(state.context.status).toBe(contextStatus);
      expect(state.warningStatus).toBe(warningStatus);
      expect(state.bannerType).toBe(bannerType);
    },
  );

  it("keeps features enabled while the retry runs", () => {
    const state = ɵresolveLicenseState({
      status: "none",
      entitlements: failedEntitlements(true),
      retryPending: true,
    });
    expect(state.context.checkFeature("threads")).toBe(true);
  });

  it("keeps features enabled when the retry did not recover", () => {
    const state = ɵresolveLicenseState({
      status: "unknown",
      entitlements: failedEntitlements(true),
      retryPending: false,
    });
    expect(state.context.checkFeature("threads")).toBe(true);
  });
});

describe("ɵresolveLicenseState terminal entitlement failure", () => {
  it.each([
    { status: "none", contextStatus: "none", bannerType: "no_license" },
    { status: undefined, contextStatus: null, bannerType: null },
    { status: "unknown", contextStatus: "unknown", bannerType: null },
  ] as const)(
    "denies every feature and limit for status $status",
    ({ status, contextStatus, bannerType }) => {
      const state = ɵresolveLicenseState({
        status,
        entitlements: failedEntitlements(false),
        retryPending: false,
      });
      expect(state.context.status).toBe(contextStatus);
      expect(state.context.checkFeature("chat")).toBe(false);
      expect(state.context.checkFeature("threads")).toBe(false);
      expect(state.context.getLimit("threads.max_count")).toBeNull();
      expect(state.bannerType).toBe(bannerType);
    },
  );

  it.each(["valid", "expiring"] as const)(
    "keeps features enabled with a %s legacy status",
    (status) => {
      const state = ɵresolveLicenseState({
        status,
        entitlements: failedEntitlements(false),
        retryPending: false,
      });
      expect(state.context.status).toBe(status);
      expect(state.context.checkFeature("chat")).toBe(true);
    },
  );

  it("ignores retryPending for a terminal failure", () => {
    const state = ɵresolveLicenseState({
      status: "none",
      entitlements: failedEntitlements(false),
      retryPending: true,
    });
    expect(state.warningStatus).toBe("none");
    expect(state.context.checkFeature("chat")).toBe(false);
  });
});

describe("ɵresolveThreadsLicense", () => {
  it.each([
    { status: null, threads: true, licensed: false, licensePending: true },
    {
      status: "unknown",
      threads: false,
      licensed: true,
      licensePending: false,
    },
    { status: "valid", threads: true, licensed: true, licensePending: false },
    { status: "valid", threads: false, licensed: false, licensePending: false },
    {
      status: "expiring",
      threads: true,
      licensed: true,
      licensePending: false,
    },
    { status: "none", threads: true, licensed: false, licensePending: false },
    {
      status: "expired",
      threads: true,
      licensed: false,
      licensePending: false,
    },
    {
      status: "invalid",
      threads: true,
      licensed: false,
      licensePending: false,
    },
  ] as const)(
    "status $status with threads $threads gives licensed $licensed",
    ({ status, threads, licensed, licensePending }) => {
      expect(
        ɵresolveThreadsLicense(
          licenseContext(status, threads),
          CONNECTING_RUNTIME,
        ),
      ).toEqual({
        licensed,
        licensePending,
      });
    },
  );

  it("unlocks the drawer for an active managed entitlement with a thread limit", () => {
    const { context } = ɵresolveLicenseState({
      status: "valid",
      entitlements: managedEntitlements(true),
      retryPending: false,
    });
    expect(ɵresolveThreadsLicense(context, CONNECTING_RUNTIME)).toEqual({
      licensed: true,
      licensePending: false,
    });
  });

  it("lets the threads endpoint decide for a runtime that connected without a license", () => {
    // A runtime without Intelligence reports no license status at all.
    expect(
      ɵresolveThreadsLicense(licenseContext(null, true), connectedRuntime()),
    ).toEqual({ licensed: true, licensePending: false });
  });

  it("stays pending while the context lags a license the runtime reported", () => {
    expect(
      ɵresolveThreadsLicense(
        licenseContext(null, true),
        connectedRuntime("none"),
      ),
    ).toEqual({ licensed: false, licensePending: true });
  });

  it("locks the drawer after a terminal entitlement failure", () => {
    const { context } = ɵresolveLicenseState({
      status: "none",
      entitlements: failedEntitlements(false),
      retryPending: false,
    });
    expect(ɵresolveThreadsLicense(context, CONNECTING_RUNTIME)).toEqual({
      licensed: false,
      licensePending: false,
    });
  });
});

describe("ɵgetLicenseBannerSpec", () => {
  const labels = CopilotChatDefaultLabels;

  it("asks for a license with an info banner when none is set", () => {
    expect(ɵgetLicenseBannerSpec("no_license", labels)).toEqual({
      severity: "info",
      message: "Powered by CopilotKit",
      actionLabel: "Get a license",
      actionUrl: "https://copilotkit.ai/pricing",
    });
  });

  it("names the unlicensed feature", () => {
    expect(
      ɵgetLicenseBannerSpec("feature_unlicensed", labels, {
        featureName: "Chat",
      }),
    ).toEqual({
      severity: "warning",
      message: '⚠ The "Chat" feature requires a CopilotKit license.',
      actionLabel: "Get a license",
      actionUrl: "https://copilotkit.ai/pricing",
    });
  });

  it("links an expiring license to the dashboard with the days left", () => {
    expect(
      ɵgetLicenseBannerSpec("expiring", labels, { graceRemaining: 3 }),
    ).toEqual({
      severity: "warning",
      message: "Your CopilotKit license expires in 3 days. Please renew.",
      actionLabel: "Renew",
      actionUrl: "https://dashboard.operations.copilotkit.ai",
    });
  });

  it("says one day in the singular", () => {
    expect(
      ɵgetLicenseBannerSpec("expiring", labels, { graceRemaining: 1 }).message,
    ).toBe("Your CopilotKit license expires in 1 day. Please renew.");
  });

  it("says soon without a day count", () => {
    expect(ɵgetLicenseBannerSpec("expiring", labels).message).toBe(
      "Your CopilotKit license expires soon. Please renew.",
    );
  });

  it("shows the expiry date of an expired license when known", () => {
    expect(
      ɵgetLicenseBannerSpec("expired", labels, { expiryDate: "2026-01-31" }),
    ).toEqual({
      severity: "critical",
      message:
        "Your CopilotKit license expired on 2026-01-31. Please renew at copilotkit.ai/pricing",
      actionLabel: "Renew now",
      actionUrl: "https://copilotkit.ai/pricing",
    });
    expect(ɵgetLicenseBannerSpec("expired", labels).message).toBe(
      "Your CopilotKit license expired. Please renew at copilotkit.ai/pricing",
    );
  });

  it("flags an invalid token as critical", () => {
    expect(ɵgetLicenseBannerSpec("invalid", labels)).toEqual({
      severity: "critical",
      message:
        "Invalid CopilotKit license token. Please check your configuration.",
      actionLabel: "Get a license",
      actionUrl: "https://copilotkit.ai/pricing",
    });
  });

  it("uses the labels it is given", () => {
    const custom = {
      ...labels,
      licenseInvalidText: "Token ungültig",
      licenseGetLicenseLabel: "Lizenz holen",
    };

    expect(ɵgetLicenseBannerSpec("invalid", custom)).toMatchObject({
      message: "Token ungültig",
      actionLabel: "Lizenz holen",
    });
  });
});

describe("ɵgetInlineFeatureWarningSpec", () => {
  it("uses the feature-unlicensed label and the pricing link", () => {
    const custom = {
      ...CopilotChatDefaultLabels,
      licenseFeatureUnlicensedText: "{feature} braucht eine Lizenz.",
    };

    expect(ɵgetInlineFeatureWarningSpec("Sidebar", custom)).toEqual({
      message: "Sidebar braucht eine Lizenz.",
      actionLabel: "Get one at copilotkit.ai/pricing",
      actionUrl: "https://copilotkit.ai/pricing",
    });
  });
});

describe("ɵreserveLicenseBannerOffset", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sets the offset variable on the root element and removes it again", () => {
    const properties = new Map<string, string>();
    vi.stubGlobal("document", {
      documentElement: {
        style: {
          setProperty: (name: string, value: string) =>
            properties.set(name, value),
          removeProperty: (name: string) => properties.delete(name),
        },
      },
    });

    const release = ɵreserveLicenseBannerOffset();
    expect(Object.fromEntries(properties)).toEqual({
      "--copilotkit-license-banner-offset": "52px",
    });
    release();

    expect(properties.size).toBe(0);
  });

  it("does nothing without a document", () => {
    expect(() => ɵreserveLicenseBannerOffset()()).not.toThrow();
  });
});
