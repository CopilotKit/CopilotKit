import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { materialize } from "./materialize.mjs";
const template = () => ({
  provider: "railway",
  purpose: "acceptance",
  bootstrap: { serviceKey: "postgres" },
  services: [
    {
      key: "postgres",
      roles: ["database"],
      env: { POSTGRES_PASSWORD: "{{run:databasePassword}}" },
    },
    {
      key: "runtime",
      roles: ["application-runtime"],
      env: {
        CONFIG: JSON.stringify({
          apiKey: "{{run:apiKey}}",
          captureToken: "{{run:captureToken}}",
          userId: "{{run:userId}}",
        }),
      },
    },
  ],
  scopes: { mastra: {}, "strands-typescript": {} },
});
test("each attempt has independent credentials and canonical hash-only bootstrap", () => {
  const original = template(),
    first = materialize(original),
    second = materialize(original);
  assert.notEqual(first.scopes.mastra.apiKey, second.scopes.mastra.apiKey);
  assert.notEqual(first.scopes.mastra.userId, second.scopes.mastra.userId);
  assert.equal(original.scopes.mastra.apiKey, undefined);
  assert.equal(
    first.scopes.mastra.credentials.apiKey,
    first.scopes.mastra.apiKey,
  );
  const bootstrap = JSON.parse(
    Buffer.from(first.services[0].env.BOOTSTRAP_CONFIG_B64, "base64"),
  );
  const parts = first.scopes.mastra.apiKey.split("_");
  assert.equal(
    bootstrap.localEvaluation.apiKeyHash,
    createHash("sha256").update(parts[2]).digest("hex"),
  );
  assert.equal(JSON.stringify(bootstrap).includes(parts[2]), false);
  assert.equal(
    bootstrap.organizations[0].id,
    first.scopes.mastra.organizationId,
  );
  assert.equal(
    JSON.parse(first.services[1].env.CONFIG).apiKey,
    first.scopes.mastra.apiKey,
  );
});
test("unknown configuration placeholder fails closed", () => {
  const config = template();
  config.services[0].env.BAD = "{{run:misspelled}}";
  assert.throws(() => materialize(config), /Unknown run/);
});

test("template uses eight owned services, private inspection and fresh scoped credentials", async () => {
  const { createTemplate } = await import("./template.mjs");
  const images = Object.fromEntries(
    [
      "postgres",
      "redis",
      "composite",
      "application",
      "strands",
      "inspector",
    ].map((key) => [key, `example/${key}@sha256:${"a".repeat(64)}`]),
  );
  const options = {
    images,
    modelCredential: "test-model",
    licenseCredential: "test-license",
    runnerUrl: "https://runner.example",
    registryActivation: { review: "test", revision: "test" },
    baseline: {
      sources: {
        copilotkit: "a".repeat(40),
        intelligence: "b".repeat(40),
        agUi: "c".repeat(40),
      },
      packages: { test: "1.0.0" },
      fixtureProvenance: "test fixture",
    },
  };
  const config = createTemplate(options),
    first = materialize(config),
    second = materialize(config);
  assert.equal(first.services.length, 8);
  assert.notEqual(first.inspection.token, second.inspection.token);
  assert.notEqual(first.inspection.token, first.scopes.mastra.capture.token);
  assert.ok(first.services.every((s) => !s.tcpPort));
  assert.equal(first.services[2].roles[0], "inspection-worker");
  assert.equal(
    first.services.find((s) => s.key === "composite").env
      .COPILOTKIT_LICENSE_TOKEN,
    "test-license",
  );
  assert.match(
    first.services.find((s) => s.key === "composite").env.S6_STAGE2_HOOK,
    /thread-culler/,
  );
  assert.throws(
    () => createTemplate({ ...options, licenseCredential: undefined }),
    /license/,
  );
});
