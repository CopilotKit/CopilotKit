import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";

/** Fresh logical bootstrap inputs only; never conversation/event fixtures. */
export function materialize(template) {
  assert.equal(template.provider, "railway");
  assert.equal(template.purpose, "acceptance");
  const slug = `rich-${randomUUID()}`;
  const short = randomBytes(8).toString("hex");
  const long = randomBytes(32).toString("hex");
  const values = {
    organizationSlug: slug,
    organizationId: `org_${slug.replaceAll("-", "_")}`,
    projectSlug: slug,
    userId: `user-${randomUUID()}`,
    inspectionToken: randomBytes(32).toString("hex"),
    captureToken: randomBytes(32).toString("hex"),
    databasePassword: randomBytes(32).toString("hex"),
    redisPassword: randomBytes(32).toString("hex"),
    authSecret: randomBytes(32).toString("hex"),
    runnerAuthSecret: randomBytes(32).toString("hex"),
    secretKeyBase: randomBytes(64).toString("hex"),
    apiKey: `cpk-{{bootstrap:projectId}}_${short}_${long}`,
  };
  function bind(value) {
    if (Array.isArray(value)) return value.map(bind);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, bind(child)]),
      );
    if (typeof value !== "string") return value;
    return value.replace(/\{\{run:([^}]+)\}\}/g, (_, key) => {
      assert.ok(
        Object.hasOwn(values, key),
        "Unknown run configuration placeholder",
      );
      return values[key];
    });
  }
  const config = bind(template);
  assert.ok(config.bootstrap?.serviceKey, "Canonical owned bootstrap required");
  const database = config.services.find(
    (service) => service.key === config.bootstrap.serviceKey,
  );
  assert.ok(database?.roles.includes("database"));
  database.env ??= {};
  database.env.BOOTSTRAP_CONFIG_B64 = Buffer.from(
    JSON.stringify({
      organizations: [
        { id: values.organizationId, slug, name: "Bounded row1 acceptance" },
      ],
      localEvaluation: {
        organizationSlug: slug,
        projectSlug: slug,
        projectName: "Bounded row1 acceptance",
        apiKeyShort: short,
        apiKeyHash: createHash("sha256").update(long).digest("hex"),
      },
    }),
  ).toString("base64");
  for (const framework of ["mastra", "strands-typescript"]) {
    const scope = config.scopes[framework];
    assert.ok(scope, "Both framework scopes required");
    scope.organizationId = values.organizationId;
    scope.projectId = "{{bootstrap:projectId}}";
    scope.apiKey = values.apiKey;
    scope.credentials = { ...scope.credentials, apiKey: values.apiKey };
    scope.userId = values.userId;
    scope.capture ??= {};
    scope.capture.token = values.captureToken;
  }
  return config;
}
