import { expect, test } from "vitest";

import { parseInspectorMetadataV1 } from "./inspector-metadata";

function metadataWithUsage(usage: unknown): Record<string, unknown> {
  return {
    schemaVersion: 1,
    identity: {
      organizationName: "Acme",
      projectName: "Support",
    },
    usage,
  };
}

function validUsage(limit: unknown = { kind: "finite", value: 100 }) {
  return {
    used: 12,
    limit,
    expiringSoonCount: 2,
  };
}

function nullPrototypeRecord(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return Object.assign(Object.create(null), fields);
}

test("parses complete metadata and strips unknown fields", () => {
  const value = {
    schemaVersion: 1,
    identity: {
      organizationName: " Acme Inc. ",
      projectName: " Support ",
      organizationId: "org-secret",
    },
    plan: {
      code: " enterprise ",
      label: " Enterprise ",
      internalPriceId: "price-secret",
    },
    license: {
      state: "valid",
      expiresAt: "2030-01-01T00:00:00.000Z",
    },
    action: {
      kind: "manage_plan",
      url: " https://cloud.copilotkit.ai/manage ",
      method: "POST",
    },
    usage: {
      used: 12,
      limit: {
        kind: "finite",
        value: 100,
        unit: "threads",
      },
      expiringSoonCount: 2,
      internalThreadIds: ["thread-secret"],
    },
    internalOrganizationId: "org-secret",
  };

  const result = parseInspectorMetadataV1(value);

  expect(result).toStrictEqual({
    schemaVersion: 1,
    identity: {
      organizationName: "Acme Inc.",
      projectName: "Support",
    },
    plan: {
      code: "enterprise",
      label: "Enterprise",
    },
    license: {
      state: "valid",
    },
    action: {
      kind: "manage_plan",
      url: "https://cloud.copilotkit.ai/manage",
    },
    usage: {
      used: 12,
      limit: {
        kind: "finite",
        value: 100,
      },
      expiringSoonCount: 2,
    },
  });
});

test("parses identity when it is the only metadata module", () => {
  const value = {
    schemaVersion: 1,
    identity: {
      organizationName: "Acme",
      projectName: "Support",
    },
  };

  const result = parseInspectorMetadataV1(value);

  expect(result).toStrictEqual({
    schemaVersion: 1,
    identity: {
      organizationName: "Acme",
      projectName: "Support",
    },
  });
});

test("parses plan when it is the only metadata module", () => {
  const value = {
    schemaVersion: 1,
    plan: {
      code: "enterprise",
      label: "Enterprise",
    },
  };

  const result = parseInspectorMetadataV1(value);

  expect(result).toStrictEqual({
    schemaVersion: 1,
    plan: {
      code: "enterprise",
      label: "Enterprise",
    },
  });
});

test("parses license when it is the only metadata module", () => {
  const value = {
    schemaVersion: 1,
    license: {
      state: "expired",
    },
  };

  const result = parseInspectorMetadataV1(value);

  expect(result).toStrictEqual({
    schemaVersion: 1,
    license: {
      state: "expired",
    },
  });
});

test("parses action when it is the only metadata module", () => {
  const value = {
    schemaVersion: 1,
    action: {
      kind: "renew",
      url: "https://cloud.copilotkit.ai/renew",
    },
  };

  const result = parseInspectorMetadataV1(value);

  expect(result).toStrictEqual({
    schemaVersion: 1,
    action: {
      kind: "renew",
      url: "https://cloud.copilotkit.ai/renew",
    },
  });
});

test("parses usage when it is the only metadata module", () => {
  const value = {
    schemaVersion: 1,
    usage: validUsage(),
  };

  const result = parseInspectorMetadataV1(value);

  expect(result).toStrictEqual({
    schemaVersion: 1,
    usage: validUsage(),
  });
});

test.each([
  {
    name: "identity",
    value: {
      schemaVersion: 1,
      identity: { organizationName: " ", projectName: "Support" },
      plan: { code: "developer", label: "Developer" },
    },
    expected: {
      schemaVersion: 1,
      plan: { code: "developer", label: "Developer" },
    },
  },
  {
    name: "plan",
    value: {
      schemaVersion: 1,
      identity: { organizationName: "Acme", projectName: "Support" },
      plan: { code: "enterprise", label: "" },
    },
    expected: {
      schemaVersion: 1,
      identity: { organizationName: "Acme", projectName: "Support" },
    },
  },
  {
    name: "license",
    value: {
      schemaVersion: 1,
      plan: { code: "developer", label: "Developer" },
      license: { state: "revoked" },
    },
    expected: {
      schemaVersion: 1,
      plan: { code: "developer", label: "Developer" },
    },
  },
  {
    name: "action",
    value: {
      schemaVersion: 1,
      plan: { code: "developer", label: "Developer" },
      action: {
        kind: "manage_plan",
        url: "http://cloud.copilotkit.ai/manage",
      },
    },
    expected: {
      schemaVersion: 1,
      plan: { code: "developer", label: "Developer" },
    },
  },
  {
    name: "usage",
    value: {
      schemaVersion: 1,
      plan: { code: "developer", label: "Developer" },
      usage: validUsage({ kind: "finite", value: 0 }),
    },
    expected: {
      schemaVersion: 1,
      plan: { code: "developer", label: "Developer" },
    },
  },
])(
  "omits an invalid $name module while retaining valid metadata",
  (testCase) => {
    const result = parseInspectorMetadataV1(testCase.value);

    expect(result).toStrictEqual(testCase.expected);
  },
);

test.each([undefined, null, "metadata", 1, true, [], new Date()])(
  "rejects non-record top-level input: %s",
  (value) => {
    const result = parseInspectorMetadataV1(value);

    expect(result).toBeUndefined();
  },
);

test("rejects a Date instance with an own schema version", () => {
  const value = Object.assign(new Date(), { schemaVersion: 1 });

  const result = parseInspectorMetadataV1(value);

  expect(result).toBeUndefined();
});

test("rejects a class instance with metadata fields", () => {
  class MetadataEnvelope {
    readonly schemaVersion = 1;
    readonly identity = {
      organizationName: "Acme",
      projectName: "Support",
    };
  }
  const value = new MetadataEnvelope();

  const result = parseInspectorMetadataV1(value);

  expect(result).toBeUndefined();
});

test("rejects a top-level object with an inherited schema version", () => {
  const value = Object.create({
    schemaVersion: 1,
    identity: {
      organizationName: "Acme",
      projectName: "Support",
    },
  });

  const result = parseInspectorMetadataV1(value);

  expect(result).toBeUndefined();
});

test("omits a module whose fields come from its prototype", () => {
  const value = {
    schemaVersion: 1,
    identity: Object.create({
      organizationName: "Acme",
      projectName: "Support",
    }),
    plan: {
      code: "developer",
      label: "Developer",
    },
  };

  const result = parseInspectorMetadataV1(value);

  expect(result).toStrictEqual({
    schemaVersion: 1,
    plan: {
      code: "developer",
      label: "Developer",
    },
  });
});

test("accepts null-prototype metadata records", () => {
  const identity = nullPrototypeRecord({
    organizationName: "Acme",
    projectName: "Support",
  });
  const value = nullPrototypeRecord({
    schemaVersion: 1,
    identity,
  });

  const result = parseInspectorMetadataV1(value);

  expect(result).toStrictEqual({
    schemaVersion: 1,
    identity: {
      organizationName: "Acme",
      projectName: "Support",
    },
  });
});

test("rejects a proxy that throws while its prototype is inspected", () => {
  const value = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error("prototype unavailable");
      },
    },
  );

  const parse = () => parseInspectorMetadataV1(value);

  expect(parse).not.toThrow();
  expect(parse()).toBeUndefined();
});

test.each([undefined, null, 0, 2, "1", true])(
  "rejects an unknown or missing schema version: %s",
  (schemaVersion) => {
    const result = parseInspectorMetadataV1({ schemaVersion });

    expect(result).toBeUndefined();
  },
);

test.each([
  "https://cloud.copilotkit.ai/manage",
  "https://cloud.copilotkit.ai/manage/plan",
  "http://localhost/manage",
  "http://localhost:3000/manage",
  "http://127.0.0.1:3000/manage",
  "http://[::1]:3000/manage",
])("accepts a safe action URL: %s", (url) => {
  const value = {
    schemaVersion: 1,
    action: {
      kind: "enable_intelligence",
      url,
    },
  };

  const result = parseInspectorMetadataV1(value);

  expect(result?.action).toStrictEqual({
    kind: "enable_intelligence",
    url,
  });
});

test.each([
  "",
  "   ",
  "/manage",
  "mailto:billing@copilotkit.ai",
  "ftp://cloud.copilotkit.ai/manage",
  "http://cloud.copilotkit.ai/manage",
  "http://localhost.example.com/manage",
  "http://sub.localhost/manage",
  "http://127.0.0.2/manage",
  "http://[::2]/manage",
  "http://0.0.0.0/manage",
  "https://@cloud.copilotkit.ai/manage",
  "https://user@cloud.copilotkit.ai/manage",
  "https://user:password@cloud.copilotkit.ai/manage",
  "https://cloud.copilotkit.ai/manage?source=inspector",
  "https://cloud.copilotkit.ai/manage?",
  "https://cloud.copilotkit.ai/manage#billing",
  "https://cloud.copilotkit.ai/manage#",
])("rejects an unsafe action URL: %s", (url) => {
  const value = {
    schemaVersion: 1,
    plan: {
      code: "developer",
      label: "Developer",
    },
    action: {
      kind: "renew",
      url,
    },
  };

  const result = parseInspectorMetadataV1(value);

  expect(result).toStrictEqual({
    schemaVersion: 1,
    plan: {
      code: "developer",
      label: "Developer",
    },
  });
});

test.each([
  { kind: "finite", value: 100 },
  { kind: "unlimited" },
  { kind: "unknown" },
])("parses the $kind usage limit", (limit) => {
  const value = {
    schemaVersion: 1,
    usage: validUsage(limit),
  };

  const result = parseInspectorMetadataV1(value);

  expect(result?.usage?.limit).toStrictEqual(limit);
});

test.each([
  -1,
  0.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.MAX_SAFE_INTEGER + 1,
  "12",
  null,
])("omits usage when used is not a finite nonnegative integer: %s", (used) => {
  const value = metadataWithUsage({
    ...validUsage(),
    used,
  });

  const result = parseInspectorMetadataV1(value);

  expect(result).toStrictEqual({
    schemaVersion: 1,
    identity: {
      organizationName: "Acme",
      projectName: "Support",
    },
  });
});

test.each([
  -1,
  0.5,
  Number.NaN,
  Number.NEGATIVE_INFINITY,
  Number.MAX_SAFE_INTEGER + 1,
  "2",
  null,
])(
  "omits usage when expiringSoonCount is not a finite nonnegative integer: %s",
  (expiringSoonCount) => {
    const value = metadataWithUsage({
      ...validUsage(),
      expiringSoonCount,
    });

    const result = parseInspectorMetadataV1(value);

    expect(result).toStrictEqual({
      schemaVersion: 1,
      identity: {
        organizationName: "Acme",
        projectName: "Support",
      },
    });
  },
);

test.each([
  0,
  -1,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.MAX_SAFE_INTEGER + 1,
  "100",
  null,
])("omits usage when a finite limit value is invalid: %s", (limitValue) => {
  const value = metadataWithUsage(
    validUsage({
      kind: "finite",
      value: limitValue,
    }),
  );

  const result = parseInspectorMetadataV1(value);

  expect(result).toStrictEqual({
    schemaVersion: 1,
    identity: {
      organizationName: "Acme",
      projectName: "Support",
    },
  });
});

test.each([
  { kind: "finite" },
  { kind: "unlimited", value: 100 },
  { kind: "unknown", reason: "hidden" },
  { kind: "metered" },
])("normalizes or rejects the usage limit shape: $kind", (limit) => {
  const value = {
    schemaVersion: 1,
    usage: validUsage(limit),
  };

  const result = parseInspectorMetadataV1(value);

  if (limit.kind === "finite" || limit.kind === "metered") {
    expect(result).toStrictEqual({ schemaVersion: 1 });
    return;
  }

  expect(result?.usage?.limit).toStrictEqual({ kind: limit.kind });
});

test.each(["", " ", "manage-plan", null, 1])(
  "omits an action with an unsupported kind: %s",
  (kind) => {
    const value = {
      schemaVersion: 1,
      action: {
        kind,
        url: "https://cloud.copilotkit.ai/manage",
      },
    };

    const result = parseInspectorMetadataV1(value);

    expect(result).toStrictEqual({ schemaVersion: 1 });
  },
);
