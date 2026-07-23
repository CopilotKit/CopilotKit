import { describe, it, expect } from "vitest";
import { createLicenseContextValue } from "../index";
import type { RuntimeLicenseStatus } from "../utils/types";

describe("createLicenseContextValue", () => {
  it("fails open when no status is known", () => {
    for (const status of [null, undefined] as const) {
      const ctx = createLicenseContextValue(status);
      expect(ctx.status).toBeNull();
      expect(ctx.license).toBeNull();
      expect(ctx.checkFeature("chat")).toBe(true);
      expect(ctx.getLimit("chat")).toBeNull();
    }
  });

  it.each(["valid", "none", "expiring", "unknown"] as RuntimeLicenseStatus[])(
    "enables features for %s status",
    (status) => {
      const ctx = createLicenseContextValue(status);
      expect(ctx.status).toBe(status);
      expect(ctx.checkFeature("chat")).toBe(true);
    },
  );

  it.each(["expired", "invalid"] as RuntimeLicenseStatus[])(
    "disables features for %s status",
    (status) => {
      const ctx = createLicenseContextValue(status);
      expect(ctx.status).toBe(status);
      expect(ctx.checkFeature("chat")).toBe(false);
    },
  );
});
