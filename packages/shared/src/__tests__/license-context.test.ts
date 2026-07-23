import { expect, test } from "vitest";
import { createLicenseContextValue } from "../index";
import type { RuntimeLicenseStatus } from "../utils/types";

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
