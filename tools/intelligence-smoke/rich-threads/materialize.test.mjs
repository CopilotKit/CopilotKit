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
