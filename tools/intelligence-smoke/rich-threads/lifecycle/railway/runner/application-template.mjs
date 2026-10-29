import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
export const templateSha256 = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");

/** Prepare in memory only. This does not authorize or execute a deployment. */
export function prepareApplicationTemplate({
  baseline,
  baselineSha256,
  applicationBefore,
  applicationAfter,
  credential,
}) {
  assert.equal(
    templateSha256(baseline),
    baselineSha256,
    "Reviewed baseline template changed",
  );
  for (const pin of [applicationBefore, applicationAfter])
    assert.ok(
      typeof pin === "string" &&
        /^ghcr\.io\/copilotkit\/rich-thread-application@sha256:[a-f0-9]{64}$/.test(
          pin,
        ),
      "Immutable application pin required",
    );
  assert.notEqual(
    applicationBefore,
    applicationAfter,
    "New application pin required",
  );
  assert.ok(
    typeof credential === "string" &&
      credential.length > 0 &&
      credential.trim() === credential &&
      !credential.includes("${{") &&
      !/[\r\n]/.test(credential),
    "Resolved credential required",
  );
  const next = structuredClone(baseline);
  assert.ok(Array.isArray(next.services), "Services required");
  const application = next.services.filter(
    (service) => service.image === applicationBefore,
  );
  assert.equal(
    application.length,
    3,
    "Expected three application image consumers",
  );
  assert.ok(
    ["native-backend", "application-runtime", "application"].every(
      (role) =>
        application.filter(
          (service) => service.roles?.length === 1 && service.roles[0] === role,
        ).length === 1,
    ),
    "Application roles changed",
  );
  const credentialServices = next.services.filter((service) =>
    Object.hasOwn(service.env ?? {}, "OPENAI_API_KEY"),
  );
  assert.equal(
    credentialServices.length,
    2,
    "Expected two native credential consumers",
  );
  assert.ok(
    credentialServices.every(
      (service) =>
        service.roles?.length === 1 && service.roles[0] === "native-backend",
    ),
    "Credential roles changed",
  );
  assert.equal(
    credentialServices.filter((service) => service.image === applicationBefore)
      .length,
    1,
    "Mastra credential consumer changed",
  );
  assert.equal(
    credentialServices.filter((service) =>
      /^ghcr\.io\/copilotkit\/rich-thread-strands@sha256:[a-f0-9]{64}$/.test(
        service.image,
      ),
    ).length,
    1,
    "Strands credential consumer changed",
  );
  for (const service of application) service.image = applicationAfter;
  for (const service of credentialServices)
    service.env.OPENAI_API_KEY = credential;
  return {
    template: next,
    receipt: {
      baselineTemplateSha256: baselineSha256,
      targetTemplateSha256: templateSha256(next),
      applicationBefore,
      applicationAfter,
      imageConsumerCount: application.length,
      credentialConsumerCount: credentialServices.length,
      credentialChanged: credentialServices.some(
        (service) =>
          baseline.services[next.services.indexOf(service)].env
            .OPENAI_API_KEY !== credential,
      ),
      deploymentAuthorized: false,
    },
  };
}

/** The new shipped policy must be the old policy with exactly one appended image. */
export function validateApplicationPolicy(
  policy,
  baselinePolicySha256,
  applicationBefore,
  applicationAfter,
) {
  assert.ok(
    Array.isArray(policy.approvedImages),
    "Approved image policy required",
  );
  assert.equal(
    policy.approvedImages.filter((image) => image === applicationAfter).length,
    1,
    "Exactly one new approval required",
  );
  assert.equal(
    policy.approvedImages.at(-1),
    applicationAfter,
    "New approval must be appended",
  );
  assert.ok(
    policy.approvedImages.includes(applicationBefore),
    "Historical application approval required",
  );
  const previous = {
    ...policy,
    approvedImages: policy.approvedImages.slice(0, -1),
  };
  const digest = createHash("sha256")
    .update(JSON.stringify(previous))
    .digest("hex");
  assert.equal(
    digest,
    baselinePolicySha256,
    "Policy must preserve every historical field and approval",
  );
}
