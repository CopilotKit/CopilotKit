import assert from "node:assert/strict";
import test from "node:test";
import { bootstrapInput, inspectBootstrapAudit } from "./bootstrap-audit.mjs";
const input = {
  organizations: [{ slug: "acceptance", name: "Acceptance" }],
  localEvaluation: { organizationSlug: "acceptance" },
};
const config = (value = input) => ({
  bootstrap: { serviceKey: "pg" },
  services: [
    {
      key: "pg",
      env: {
        BOOTSTRAP_CONFIG_B64: Buffer.from(JSON.stringify(value)).toString(
          "base64",
        ),
      },
    },
  ],
});
const common = {
  actor_id: null,
  project_id: null,
  role: null,
  access_source: "bootstrap",
  request_id: null,
  trace_id: null,
};
const rows = [
  {
    ...common,
    event_type: "self_hosted.bootstrap_organization_created",
    organization_id: "org_acceptance",
    payload: {
      organizationId: "org_acceptance",
      slug: "acceptance",
      name: "Acceptance",
      source: "bootstrap",
    },
  },
  {
    ...common,
    event_type: "self_hosted.bootstrap_applied",
    organization_id: null,
    payload: {
      configuredOrganizations: 1,
      insertedOrganizations: 1,
      skippedConflictingOrganizations: 0,
      insertedOrgMappings: 0,
      insertedPlatformAdminMappings: 0,
      insertedEmergencyGrants: 0,
    },
  },
];
test("only exact two canonical initialization audit events pass", () => {
  const inspect = (values) =>
    inspectBootstrapAudit(values, config(), {
      organizationId: "org_acceptance",
    });
  assert.equal(inspect(rows).status, "passed");
  for (const values of [
    [],
    [...rows, rows[0]],
    [{ ...rows[0], organization_id: "org_shared" }, rows[1]],
    [
      { ...rows[0], payload: { ...rows[0].payload, message: "unexpected" } },
      rows[1],
    ],
    [{ ...rows[0], actor_id: "actor" }, rows[1]],
    [{ ...rows[0], event_type: "thread.created" }, rows[1]],
  ])
    assert.equal(inspect(values).status, "failed");
});
test("bounded bootstrap rejects extra organization/access grants", () => {
  assert.deepEqual(bootstrapInput(config()), input);
  for (const value of [
    {
      ...input,
      organizations: [...input.organizations, ...input.organizations],
    },
    { ...input, platformAdminMappings: [{}] },
    { ...input, emergencyPlatformAdminGrants: [{}] },
    {
      ...input,
      organizations: [{ ...input.organizations[0], mappings: [{}] }],
    },
  ])
    assert.throws(() => bootstrapInput(config(value)));
});
