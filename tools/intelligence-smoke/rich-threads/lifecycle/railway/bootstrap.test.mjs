import assert from "node:assert/strict";
import test from "node:test";
import {
  bootstrapSource,
  validateBootstrap,
  bindBootstrap,
  parseBootstrapIdentity,
  runBootstrap,
} from "./bootstrap.mjs";

const identity = {
  version: 1,
  projectId: "17",
  organizationId: "org_acceptance",
  apiKey: "must-not-retain",
};
const output = `COMMIT\nCPKI_LOCAL_BOOTSTRAP=${JSON.stringify(identity)}\n`;
const config = () => ({
  bootstrap: {
    ...bootstrapSource,
    scriptPath: "/private/bootstrap.sh",
    serviceKey: "postgres",
    afterServiceKey: "composite",
  },
  database: {
    serviceKey: "postgres",
    user: "postgres",
    password: "private",
    database: "owned",
  },
  services: [
    {
      key: "postgres",
      roles: ["database"],
      env: {
        DATABASE_URL: "postgresql://user:password@localhost:5432/database",
        BOOTSTRAP_CONFIG_B64: Buffer.from(
          JSON.stringify({
            organizations: [{ slug: "acceptance", name: "Acceptance" }],
            localEvaluation: { organizationSlug: "acceptance" },
          }),
        ).toString("base64"),
      },
    },
    { key: "composite", roles: ["intelligence-api"] },
    {
      key: "runtime",
      roles: ["application-runtime", "native-backend", "application"],
    },
  ],
});

test("bootstrap requires pinned canonical source and deploy order before applications", () => {
  validateBootstrap(config());
  const unpinned = config();
  unpinned.bootstrap.sha256 = "0".repeat(64);
  assert.throws(() => validateBootstrap(unpinned));
  const wrongOrder = config();
  wrongOrder.services.reverse();
  assert.throws(() => validateBootstrap(wrongOrder));
  const external = config();
  external.database.serviceKey = "external";
  assert.throws(() => validateBootstrap(external));
  const absentEnv = config();
  delete absentEnv.services[0].env.BOOTSTRAP_CONFIG_B64;
  assert.throws(() => validateBootstrap(absentEnv));
});

test("bootstrap parses exactly one committed identity and drops other output fields", () => {
  assert.deepEqual(parseBootstrapIdentity(output), {
    ...bootstrapSource,
    projectId: identity.projectId,
    organizationId: identity.organizationId,
  });
  for (const value of [
    "COMMIT",
    output + output,
    "CPKI_LOCAL_BOOTSTRAP={",
    'CPKI_LOCAL_BOOTSTRAP={"version":1}',
  ])
    assert.throws(() => parseBootstrapIdentity(value));
});

test("bindings fail closed before bootstrap and bind generated IDs in scopes/env", () => {
  assert.throws(() => bindBootstrap("{{bootstrap:projectId}}"));
  assert.throws(() => bindBootstrap("{{bootstrap:apiKey}}", identity));
  assert.deepEqual(
    bindBootstrap(
      {
        projectId: "{{bootstrap:projectId}}",
        env: ["organization={{bootstrap:organizationId}}"],
      },
      identity,
    ),
    { projectId: identity.projectId, env: ["organization=org_acceptance"] },
  );
});

test("modified private script cannot execute any remote command", async () => {
  let called = false;
  await assert.rejects(
    runBootstrap({
      config: config(),
      journal: {},
      service: {},
      readScript: async () => "changed",
      execute: async () => {
        called = true;
      },
    }),
    /digest mismatch/,
  );
  assert.equal(called, false);
});
