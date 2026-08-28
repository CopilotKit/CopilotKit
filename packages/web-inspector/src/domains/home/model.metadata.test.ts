import { expect, test } from "vitest";

import { projectInspectorMetadata } from "./model.js";
import type { InspectorMetadataProjection } from "./model.js";

type MetadataOverrides = Partial<{
  schemaVersion: unknown;
  identity: unknown;
  plan: unknown;
  license: unknown;
  action: unknown;
  usage: unknown;
}>;

function metadata(overrides: MetadataOverrides = {}) {
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

test("projects normalized metadata, usage, and one trusted manage action", () => {
  const result = projectInspectorMetadata(metadata(), "valid");

  expect(result).toStrictEqual({
    identity: { organizationName: "Acme Inc.", projectName: "Support" },
    plan: { code: "enterprise", label: "Enterprise" },
    usage: {
      used: 148,
      limit: { kind: "finite", value: 200 },
      expiringSoonCount: 37,
    },
    licenseState: "valid",
    hasLicenseConflict: false,
    threadsFooterAction: {
      kind: "manage_plan",
      url: "https://cloud.copilotkit.ai/settings/billing",
      label: "Manage Your Plan",
    },
  });
  expect(result.lockedAction).toBeUndefined();
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
    usage: {
      used: 148,
      limit: { kind: "finite", value: 200 },
      expiringSoonCount: 37,
    },
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
      usage: undefined,
    }),
    "valid",
  );
  const projectOnly = projectInspectorMetadata(
    metadata({
      identity: { organizationName: " ", projectName: "Support" },
      plan: undefined,
      action: undefined,
      usage: undefined,
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
      usage: undefined,
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

test("projects an action-only valid manage action into one canonical footer slot", () => {
  const url = "https://cloud.copilotkit.ai/settings/billing";
  const result = projectInspectorMetadata(
    metadata({
      identity: undefined,
      plan: undefined,
      license: undefined,
      action: { kind: "manage_plan", url },
      usage: undefined,
    }),
    "valid",
  );

  expect(result.threadsFooterAction).toStrictEqual({
    kind: "manage_plan",
    url,
    label: "Manage Your Plan",
  });
  expect(result.usage).toBeUndefined();
  expect(result.lockedAction).toBeUndefined();
});

test.each([
  [
    "none enable Intelligence",
    "none",
    "enable_intelligence",
    "Enable Intelligence",
  ],
  ["expired renew", "expired", "renew", "Renew"],
  ["expired manage plan", "expired", "manage_plan", "Manage Your Plan"],
] as const)(
  "places the %s action in the locked slot only",
  (_name, state, kind, label) => {
    const url = `https://cloud.copilotkit.ai/${kind}`;
    const result = projectInspectorMetadata(
      metadata({
        identity: undefined,
        plan: undefined,
        license: { state },
        action: { kind, url },
        usage: undefined,
      }),
      state,
    );

    expect(result).toStrictEqual({
      licenseState: state,
      hasLicenseConflict: false,
      lockedAction: { kind, url, label },
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
      usage: undefined,
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
    usage: {
      used: 148,
      limit: { kind: "finite", value: 200 },
      expiringSoonCount: 37,
    },
    licenseState: "expired",
    hasLicenseConflict: true,
  });
  expect(result.threadsFooterAction).toBeUndefined();
  expect(result.lockedAction).toBeUndefined();
});

test("metadata unknown is not a known disagreement and does not fall back", () => {
  const result = projectInspectorMetadata(
    metadata({
      identity: undefined,
      plan: undefined,
      license: { state: "unknown" },
      usage: undefined,
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

test.each([
  [{ code: "enterprise", label: "Enterprise" }],
  [{ code: "team-self-hosted", label: "Team Self-Hosted" }],
] as const)("does not infer an action from the %s plan", (plan) => {
  const result = projectInspectorMetadata(
    metadata({
      identity: undefined,
      plan,
      license: undefined,
      action: undefined,
      usage: undefined,
    }),
    "valid",
  );

  expect(result).toStrictEqual({
    plan,
    licenseState: "valid",
    hasLicenseConflict: false,
  });
  expect(result.threadsFooterAction).toBeUndefined();
  expect(result.lockedAction).toBeUndefined();
});

test("preserves the parser-approved action href without adding query data", () => {
  const url = "https://cloud.copilotkit.ai/organizations/acme/billing";
  const result = projectInspectorMetadata(
    metadata({ action: { kind: "manage_plan", url } }),
    "valid",
  );

  expect(result.threadsFooterAction?.url).toBe(url);
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

  expect(result.threadsFooterAction).toBeUndefined();
  expect(result.lockedAction).toBeUndefined();
});

test.each([
  [
    "finite under-cap with expiry",
    {
      used: 148,
      limit: { kind: "finite", value: 200 },
      expiringSoonCount: 37,
    },
    true,
  ],
  [
    "finite over-cap with known zero expiry",
    {
      used: 241,
      limit: { kind: "finite", value: 200 },
      expiringSoonCount: 0,
    },
    true,
  ],
  [
    "unlimited with known zero expiry",
    {
      used: 412,
      limit: { kind: "unlimited" },
      expiringSoonCount: 0,
    },
    true,
  ],
  [
    "unknown with absent expiry",
    { used: 17, limit: { kind: "unknown" } },
    false,
  ],
] as const)(
  "projects %s usage unchanged",
  (_name, usage, expectedOwnExpiry) => {
    const result = projectInspectorMetadata(
      metadata({
        identity: undefined,
        plan: undefined,
        license: undefined,
        action: undefined,
        usage,
      }),
      "valid",
    );

    expect(result).toStrictEqual({
      usage,
      licenseState: "valid",
      hasLicenseConflict: false,
    });
    expect(
      Object.prototype.hasOwnProperty.call(
        result.usage ?? {},
        "expiringSoonCount",
      ),
    ).toBe(expectedOwnExpiry);
  },
);

test("drops malformed expiry without dropping base usage or a valid sibling", () => {
  const result = projectInspectorMetadata(
    metadata({
      identity: undefined,
      plan: { code: "developer", label: " Developer " },
      license: undefined,
      action: undefined,
      usage: {
        used: 21,
        limit: { kind: "finite", value: 50 },
        expiringSoonCount: "37",
      },
    }),
    "valid",
  );

  expect(result).toStrictEqual({
    plan: { code: "developer", label: "Developer" },
    usage: { used: 21, limit: { kind: "finite", value: 50 } },
    licenseState: "valid",
    hasLicenseConflict: false,
  });
  expect(
    Object.prototype.hasOwnProperty.call(
      result.usage ?? {},
      "expiringSoonCount",
    ),
  ).toBe(false);
});

test.each([
  ["invalid used count", { used: -1, limit: { kind: "finite", value: 200 } }],
  ["invalid finite limit", { used: 148, limit: { kind: "finite", value: 0 } }],
] as const)(
  "drops usage with an %s while retaining a valid sibling",
  (_name, usage) => {
    const result = projectInspectorMetadata(
      metadata({
        identity: undefined,
        plan: { code: "developer", label: " Developer " },
        license: undefined,
        action: undefined,
        usage,
      }),
      "valid",
    );

    expect(result).toStrictEqual({
      plan: { code: "developer", label: "Developer" },
      licenseState: "valid",
      hasLicenseConflict: false,
    });
    expect(result.usage).toBeUndefined();
  },
);
