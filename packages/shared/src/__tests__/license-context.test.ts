import { expect, test } from "vitest";
import { createLicenseContextValue } from "../index";
import type {
  RuntimeEntitlementResponse,
  RuntimeLicenseStatus,
} from "../utils/types";

test("license context fails open when no status is known", () => {
  for (const status of [null, undefined] as const) {
    const ctx = createLicenseContextValue(status);
    expect(ctx.status).toBeNull();
    expect(ctx.license).toBeNull();
    expect(ctx.checkFeature("chat")).toBe(true);
    expect(ctx.getLimit("chat")).toBeNull();
  }
});

test.each(["valid", "none", "expiring", "unknown"] as RuntimeLicenseStatus[])(
  "license context enables features for %s status",
  (status) => {
    const ctx = createLicenseContextValue(status);
    expect(ctx.status).toBe(status);
    expect(ctx.checkFeature("chat")).toBe(true);
  },
);

test.each(["expired", "invalid"] as RuntimeLicenseStatus[])(
  "license context disables features for %s status",
  (status) => {
    const ctx = createLicenseContextValue(status);
    expect(ctx.status).toBe(status);
    expect(ctx.checkFeature("chat")).toBe(false);
  },
);

test("license context uses ready active feature grants and numeric limits", () => {
  const ctx = createLicenseContextValue("valid", {
    status: "ready",
    entitlement: {
      active: true,
      source: "managedOrgSubscription",
      features: {
        chat: true,
        threads: false,
      },
      limits: {
        threads: 25,
      },
    },
  });

  expect(ctx.checkFeature("chat")).toBe(true);
  expect(ctx.checkFeature("threads")).toBe(false);
  expect(ctx.checkFeature("unknown")).toBe(false);
  expect(ctx.getLimit("threads")).toBe(25);
  expect(ctx.getLimit("unknown")).toBeNull();
});

test.each([0, 25])(
  "license context treats an own threads.max_count limit of %s as a thread grant",
  (threadLimit) => {
    const ctx = createLicenseContextValue("valid", {
      status: "ready",
      entitlement: {
        active: true,
        source: "managedOrgSubscription",
        features: {},
        limits: { "threads.max_count": threadLimit },
      },
    });

    expect(ctx.checkFeature("threads")).toBe(true);
    expect(ctx.getLimit("threads.max_count")).toBe(threadLimit);
  },
);

test.each([
  {
    source: "managedOrgSubscription" as const,
    features: {},
    limits: {
      "threads.retention_hours": 72,
      "threads.max_count": 200,
    },
  },
  {
    source: "selfHostedDeploymentLicense" as const,
    features: {
      deployment_via_helm_chart: true,
      msteams: true,
    },
    limits: {
      "threads.retention_hours": 336,
      "threads.max_count": 25000,
    },
  },
])(
  "license context preserves legacy UI features for an active $source payload",
  (entitlement) => {
    const ctx = createLicenseContextValue("valid", {
      status: "ready",
      entitlement: {
        active: true,
        ...entitlement,
      },
    });

    for (const feature of ["chat", "popup", "sidebar", "threads"]) {
      expect(ctx.checkFeature(feature)).toBe(true);
    }
    expect(ctx.checkFeature("unknown")).toBe(false);
  },
);

test.each(["chat", "popup", "sidebar"])(
  "license context preserves an explicit %s denial",
  (feature) => {
    const ctx = createLicenseContextValue("valid", {
      status: "ready",
      entitlement: {
        active: true,
        source: "managedOrgSubscription",
        features: { [feature]: false },
        limits: {},
      },
    });

    expect(ctx.checkFeature(feature)).toBe(false);
  },
);

test.each([true, false])(
  "license context preserves a legacy threads feature value of %s",
  (threads) => {
    const ctx = createLicenseContextValue("valid", {
      status: "ready",
      entitlement: {
        active: true,
        source: "selfHostedDeploymentLicense",
        features: { threads },
        limits: {},
      },
    });

    expect(ctx.checkFeature("threads")).toBe(threads);
  },
);

test("license context denies features and limits for a ready inactive entitlement", () => {
  const ctx = createLicenseContextValue("none", {
    status: "ready",
    entitlement: {
      active: false,
      source: "managedOrgSubscription",
      features: {
        chat: true,
      },
      limits: {
        threads: 25,
      },
    },
  });

  expect(ctx.checkFeature("chat")).toBe(false);
  expect(ctx.getLimit("threads")).toBeNull();
});

test("license context does not fall back for an inactive AWS Marketplace entitlement", () => {
  const marketplaceEntitlements = {
    status: "ready",
    entitlement: {
      active: false,
      source: "awsMarketplaceDeploymentLicense",
      features: {},
      limits: {},
    },
  } as const satisfies RuntimeEntitlementResponse;

  const ctx = createLicenseContextValue("valid", marketplaceEntitlements);

  expect(ctx.status).toBe("none");
  expect(ctx.checkFeature("threads")).toBe(false);
  expect(ctx.getLimit("threads")).toBeNull();
});

test.each(["valid", "expiring"] as RuntimeLicenseStatus[])(
  "license context preserves a %s legacy fallback for an inactive self-hosted entitlement",
  (status) => {
    const ctx = createLicenseContextValue(status, {
      status: "ready",
      entitlement: {
        active: false,
        source: "selfHostedDeploymentLicense",
        features: {
          threads: false,
        },
        limits: {
          threads: 0,
        },
      },
    });

    expect(ctx.status).toBe(status);
    expect(ctx.checkFeature("threads")).toBe(true);
    expect(ctx.getLimit("threads")).toBeNull();
  },
);

test.each([
  { status: undefined, expectedStatus: "none" },
  { status: "none", expectedStatus: "none" },
  { status: "expired", expectedStatus: "expired" },
  { status: "invalid", expectedStatus: "invalid" },
  { status: "unknown", expectedStatus: "unknown" },
] as const)(
  "license context denies an inactive self-hosted entitlement with $status legacy status",
  ({ status, expectedStatus }) => {
    const ctx = createLicenseContextValue(status, {
      status: "ready",
      entitlement: {
        active: false,
        source: "selfHostedDeploymentLicense",
        features: {
          threads: true,
        },
        limits: {
          threads: 25,
        },
      },
    });

    expect(ctx.status).toBe(expectedStatus);
    expect(ctx.checkFeature("threads")).toBe(false);
    expect(ctx.getLimit("threads")).toBeNull();
  },
);

test("license context ignores inherited feature and limit keys", () => {
  const ctx = createLicenseContextValue("valid", {
    status: "ready",
    entitlement: {
      active: true,
      source: "managedOrgSubscription",
      features: {},
      limits: {},
    },
  });

  for (const feature of ["toString", "constructor"]) {
    expect(ctx.checkFeature(feature)).toBe(false);
    expect(ctx.getLimit(feature)).toBeNull();
  }
});
