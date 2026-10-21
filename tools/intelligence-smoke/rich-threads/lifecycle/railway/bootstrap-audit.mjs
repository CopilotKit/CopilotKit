import assert from "node:assert/strict";

// Organization/project INSERT triggers create these configuration defaults.
// Inspect their contents; Learning runs, receipts and other data stay zero-only.
export function inspectBootstrapSchedules(rows, identity) {
  const expected = [
    {
      name: "cpki.learning_schedules",
      row: {
        organization_id: identity.organizationId,
        local_time: "02:00",
        time_zone: "Etc/UTC",
      },
    },
    {
      name: "cpki.learning_project_schedules",
      row: {
        organization_id: identity.organizationId,
        project_id: Number(identity.projectId),
        local_time: null,
        time_zone: null,
      },
    },
  ];
  try {
    assert.deepEqual(
      [...rows].sort((a, b) => a.name.localeCompare(b.name)),
      expected.sort((a, b) => a.name.localeCompare(b.name)),
    );
    return {
      status: "passed",
      method: "exact-canonical-bootstrap-schedule-content",
    };
  } catch {
    return {
      status: "failed",
      method: "exact-canonical-bootstrap-schedule-content",
    };
  }
}

export function bootstrapInput(config) {
  const database = config.services.find(
    (s) => s.key === config.bootstrap.serviceKey,
  );
  let input;
  try {
    input = JSON.parse(
      Buffer.from(database.env.BOOTSTRAP_CONFIG_B64, "base64").toString("utf8"),
    );
  } catch {
    throw new Error("Invalid private bootstrap configuration");
  }
  assert.ok(
    input.organizations?.length === 1,
    "Exactly one bootstrap organization required",
  );
  const org = input.organizations[0];
  assert.ok(
    !org.mappings?.length &&
      !input.platformAdminMappings?.length &&
      !input.emergencyPlatformAdminGrants?.length,
    "Access mappings are outside bounded bootstrap",
  );
  assert.ok(
    typeof org.slug === "string" &&
      /^[a-z0-9-]+$/.test(org.slug) &&
      typeof org.name === "string" &&
      org.name.length > 0,
    "Invalid bootstrap organization",
  );
  assert.ok(
    !org.id || /^org_[a-z0-9_]+$/.test(org.id),
    "Invalid bootstrap organization ID",
  );
  assert.ok(
    input.localEvaluation?.organizationSlug === org.slug,
    "Bootstrap organization mismatch",
  );
  return input;
}

export function inspectBootstrapAudit(rows, config, identity) {
  const org = bootstrapInput(config).organizations[0];
  const common = {
    actor_id: null,
    project_id: null,
    role: null,
    access_source: "bootstrap",
    request_id: null,
    trace_id: null,
  };
  const expected = [
    {
      ...common,
      event_type: "self_hosted.bootstrap_organization_created",
      organization_id: identity.organizationId,
      payload: {
        organizationId: identity.organizationId,
        slug: org.slug,
        name: org.name,
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
  let passed = false;
  try {
    assert.deepEqual(
      [...rows].sort((a, b) => a.event_type.localeCompare(b.event_type)),
      expected.sort((a, b) => a.event_type.localeCompare(b.event_type)),
    );
    passed = true;
  } catch {
    /* Return value-free findings; audit payloads may contain user data. */
  }
  return {
    status: passed ? "passed" : "failed",
    count: rows.length,
    expected: 2,
    method: "exact-canonical-bootstrap-audit-content",
  };
}
