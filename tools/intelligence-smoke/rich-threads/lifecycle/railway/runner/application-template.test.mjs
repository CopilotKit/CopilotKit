import assert from "node:assert/strict";
import { test } from "node:test";
import {
  prepareApplicationTemplate,
  templateSha256,
} from "./application-template.mjs";

const oldImage = `ghcr.io/copilotkit/rich-thread-application@sha256:${"a".repeat(64)}`;
const newImage = `ghcr.io/copilotkit/rich-thread-application@sha256:${"b".repeat(64)}`;
const fixture = () => ({
  projectId: "retained-project",
  services: [
    {
      roles: ["native-backend"],
      image: oldImage,
      env: { OPENAI_API_KEY: "old-mastra", PRESERVE: "yes" },
    },
    {
      roles: ["native-backend"],
      image: `ghcr.io/copilotkit/rich-thread-strands@sha256:${"c".repeat(64)}`,
      env: { OPENAI_API_KEY: "old-strands" },
    },
    { roles: ["application-runtime"], image: oldImage },
    { roles: ["application"], image: oldImage },
    { roles: ["database"], image: "unchanged-database" },
  ],
  permanentRunner: { volumeId: "preserve-volume" },
});
const prepare = (baseline, overrides = {}) =>
  prepareApplicationTemplate({
    baseline,
    baselineSha256: templateSha256(baseline),
    applicationBefore: oldImage,
    applicationAfter: newImage,
    credential: "replacement-test-secret",
    ...overrides,
  });

test("preparation changes only three application pins and two credential fields without mutating input", () => {
  const baseline = fixture(),
    saved = structuredClone(baseline);
  const { template, receipt } = prepare(baseline);
  assert.deepEqual(baseline, saved);
  const expected = structuredClone(saved);
  for (const index of [0, 2, 3]) expected.services[index].image = newImage;
  for (const index of [0, 1])
    expected.services[index].env.OPENAI_API_KEY = "replacement-test-secret";
  assert.deepEqual(template, expected);
  assert.equal(receipt.targetTemplateSha256, templateSha256(expected));
  assert.equal(receipt.deploymentAuthorized, false);
  assert.equal(
    JSON.stringify(receipt).includes("replacement-test-secret"),
    false,
  );
});
test("baseline drift is rejected before preparing secrets", () => {
  const baseline = fixture(),
    hash = templateSha256(baseline);
  baseline.projectId = "other-project";
  assert.throws(
    () => prepare(baseline, { baselineSha256: hash }),
    /baseline template changed/,
  );
});
test("ambiguous roles or additional credential recipients are refused", () => {
  for (const mutate of [
    (value) => value.services.push(structuredClone(value.services[0])),
    (value) => {
      value.services[4].env = { OPENAI_API_KEY: "unexpected" };
    },
    (value) => {
      value.services[0].roles.push("application");
    },
    (value) => {
      value.services[1].image = newImage;
    },
  ]) {
    const value = fixture();
    mutate(value);
    assert.throws(() => prepare(value));
  }
});
test("unresolved, empty, multiline credentials and mutable images are refused without values in diagnostics", () => {
  for (const credential of [
    "",
    "${{aimoc.AIMOCK_PROVIDER_OPENAI_KEY}}",
    " secret ",
    "secret\nvalue",
    null,
  ])
    assert.throws(
      () => prepare(fixture(), { credential }),
      (error) => error.message === "Resolved credential required",
    );
  assert.throws(
    () =>
      prepare(fixture(), {
        applicationAfter: "ghcr.io/copilotkit/rich-thread-application:latest",
      }),
    /Immutable application pin required/,
  );
});

test("policy approval is additive and retains every historical constraint", async () => {
  const { createHash } = await import("node:crypto");
  const { validateApplicationPolicy } =
    await import("./application-template.mjs");
  const old = {
    projectId: "original",
    forbiddenEnvironmentIds: ["production"],
    permanentServices: [{ serviceId: "protected" }],
    approvedImages: [oldImage, "historical"],
  };
  const hash = createHash("sha256").update(JSON.stringify(old)).digest("hex");
  const next = { ...old, approvedImages: [...old.approvedImages, newImage] };
  validateApplicationPolicy(next, hash, oldImage, newImage);
  for (const mutate of [
    (v) => {
      v.projectId = "other";
    },
    (v) => {
      v.forbiddenEnvironmentIds = [];
    },
    (v) => {
      v.permanentServices = [];
    },
    (v) => {
      v.approvedImages.splice(1, 1);
    },
    (v) => {
      v.approvedImages.push("extra");
    },
    (v) => {
      v.approvedImages.push(newImage);
    },
  ]) {
    const invalid = structuredClone(next);
    mutate(invalid);
    assert.throws(() =>
      validateApplicationPolicy(invalid, hash, oldImage, newImage),
    );
  }
});
