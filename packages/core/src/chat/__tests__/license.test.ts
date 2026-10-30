import { describe, expect, it } from "vitest";
import type {
  LicenseContextValue,
  RuntimeEntitlementResponse,
  RuntimeLicenseStatus,
} from "@copilotkit/shared";
import { ɵresolveLicenseState, ɵresolveThreadsLicense } from "../license";

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
      expect(ɵresolveThreadsLicense(licenseContext(status, threads))).toEqual({
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
    expect(ɵresolveThreadsLicense(context)).toEqual({
      licensed: true,
      licensePending: false,
    });
  });

  it("locks the drawer after a terminal entitlement failure", () => {
    const { context } = ɵresolveLicenseState({
      status: "none",
      entitlements: failedEntitlements(false),
      retryPending: false,
    });
    expect(ɵresolveThreadsLicense(context)).toEqual({
      licensed: false,
      licensePending: false,
    });
  });
});
