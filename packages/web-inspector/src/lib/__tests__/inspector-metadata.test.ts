import { expect, test } from "vitest";

import { projectInspectorMetadata } from "../inspector-metadata.js";
import type { InspectorMetadataProjection } from "../inspector-metadata.js";

function metadata(overrides: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: 1,
    identity: {
      organizationName: " Acme Inc. ",
      projectName: " Support ",
    },
    plan: { code: "enterprise", label: " Enterprise " },
    license: { state: "valid" },
    action: {
      kind: "manage_plan",
      url: "https://cloud.copilotkit.ai/settings/billing",
    },
    usage: {
      used: 148,
      limit: { kind: "finite", value: 200 },
      expiringSoonCount: 37,
    },
    ...overrides,
  };
}

function emptyProjection(
  licenseState: InspectorMetadataProjection["licenseState"] = "unknown",
): InspectorMetadataProjection {
  return {
    licenseState,
    hasLicenseConflict: false,
  };
}

test("projects normalized identity, plan, license, and a trusted header action", () => {
  const result = projectInspectorMetadata(metadata(), "valid");

  expect(result).toStrictEqual({
    identity: { organizationName: "Acme Inc.", projectName: "Support" },
    plan: { code: "enterprise", label: "Enterprise" },
    licenseState: "valid",
    hasLicenseConflict: false,
    headerAction: {
      kind: "manage_plan",
      url: "https://cloud.copilotkit.ai/settings/billing",
      label: "Manage plan",
    },
  });
});

test("keeps valid metadata modules when neighboring modules are missing or malformed", () => {
  const result = projectInspectorMetadata(
    metadata({
      identity: { organizationName: "Acme", projectName: " " },
      plan: { code: "developer", label: " Developer " },
      action: { kind: "manage_plan", url: "javascript:alert(1)" },
    }),
    "valid",
  );

  expect(result).toStrictEqual({
    plan: { code: "developer", label: "Developer" },
    licenseState: "valid",
    hasLicenseConflict: false,
  });
});

test("renders identity only as a complete organization and project pair", () => {
  const organizationOnly = projectInspectorMetadata(
    metadata({
      identity: { organizationName: "Acme", projectName: " " },
      plan: undefined,
      action: undefined,
    }),
    "valid",
  );
  const projectOnly = projectInspectorMetadata(
    metadata({
      identity: { organizationName: " ", projectName: "Support" },
      plan: undefined,
      action: undefined,
    }),
    "valid",
  );

  expect(organizationOnly).toStrictEqual(emptyProjection("valid"));
  expect(projectOnly).toStrictEqual(emptyProjection("valid"));
});

test("omits a blank plan instead of inventing a placeholder or Free tier", () => {
  const result = projectInspectorMetadata(
    metadata({
      identity: undefined,
      plan: { code: "free", label: "  " },
      action: undefined,
    }),
    "valid",
  );

  expect(result).toStrictEqual(emptyProjection("valid"));
});

test.each([
  ["valid", "valid"],
  ["expiring", "valid"],
  ["none", "none"],
  ["expired", "expired"],
  ["invalid", "expired"],
  ["unknown", "unknown"],
  [undefined, "unknown"],
] as const)("normalizes Runtime license %s to %s", (runtime, expected) => {
  const result = projectInspectorMetadata(undefined, runtime);

  expect(result).toStrictEqual(emptyProjection(expected));
});

test.each([
  ["valid manage plan", "valid", "manage_plan", "headerAction", "Manage plan"],
  [
    "none enable Intelligence",
    "none",
    "enable_intelligence",
    "lockedAction",
    "Enable Intelligence",
  ],
  ["expired renew", "expired", "renew", "lockedAction", "Renew"],
  [
    "expired manage plan",
    "expired",
    "manage_plan",
    "lockedAction",
    "Manage plan",
  ],
] as const)(
  "places the %s action in the intended slot",
  (_name, state, kind, slot, label) => {
    const url = `https://cloud.copilotkit.ai/${kind}`;
    const result = projectInspectorMetadata(
      metadata({
        identity: undefined,
        plan: undefined,
        license: { state },
        action: { kind, url },
      }),
      state,
    );

    expect(result).toStrictEqual({
      licenseState: state,
      hasLicenseConflict: false,
      [slot]: { kind, url, label },
    });
  },
);

test.each([
  ["valid", "renew"],
  ["valid", "enable_intelligence"],
  ["none", "manage_plan"],
  ["none", "renew"],
  ["expired", "enable_intelligence"],
  ["unknown", "manage_plan"],
  ["unknown", "renew"],
  ["unknown", "enable_intelligence"],
] as const)("omits mismatched %s plus %s actions", (state, kind) => {
  const result = projectInspectorMetadata(
    metadata({
      identity: undefined,
      plan: undefined,
      license: { state },
      action: {
        kind,
        url: "https://cloud.copilotkit.ai/settings/billing",
      },
    }),
    state,
  );

  expect(result).toStrictEqual(emptyProjection(state));
});

test("uses Runtime copy and suppresses metadata actions for a known disagreement", () => {
  const result = projectInspectorMetadata(
    metadata({ license: { state: "none" } }),
    "expired",
  );

  expect(result).toStrictEqual({
    identity: { organizationName: "Acme Inc.", projectName: "Support" },
    plan: { code: "enterprise", label: "Enterprise" },
    licenseState: "expired",
    hasLicenseConflict: true,
  });
});

test("metadata unknown is not a known disagreement and does not fall back", () => {
  const result = projectInspectorMetadata(
    metadata({
      identity: undefined,
      plan: undefined,
      license: { state: "unknown" },
    }),
    "valid",
  );

  expect(result).toStrictEqual(emptyProjection());
});

test("missing and unsupported metadata preserve the normalized Runtime state", () => {
  const missing = projectInspectorMetadata(undefined, "none");
  const unsupported = projectInspectorMetadata(
    { schemaVersion: 2, license: { state: "valid" } },
    "invalid",
  );

  expect(missing).toStrictEqual(emptyProjection("none"));
  expect(unsupported).toStrictEqual(emptyProjection("expired"));
});

test("preserves the parser-approved action href without adding query data", () => {
  const url = "https://cloud.copilotkit.ai/organizations/acme/billing";
  const result = projectInspectorMetadata(
    metadata({ action: { kind: "manage_plan", url } }),
    "valid",
  );

  expect(result.headerAction?.url).toBe(url);
});

test.each([
  "https://user@example.com/manage",
  "https://example.com/manage?ref=inspector",
  "https://example.com/manage#billing",
  "http://example.com/manage",
  "javascript:alert(1)",
] as const)("omits unsafe action URL %s", (url) => {
  const result = projectInspectorMetadata(
    metadata({ action: { kind: "manage_plan", url } }),
    "valid",
  );

  expect(result.headerAction).toBeUndefined();
});

test("never projects usage, including sentinel values", () => {
  const result = projectInspectorMetadata(metadata(), "valid");
  const serialized = JSON.stringify(result);

  expect(serialized).not.toContain("148");
  expect(serialized).not.toContain("200");
  expect(serialized).not.toContain("37");
  expect(serialized).not.toContain("usage");
  expect(serialized).not.toContain("expiringSoonCount");
});
