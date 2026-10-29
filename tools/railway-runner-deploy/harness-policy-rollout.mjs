import assert from "node:assert/strict";
import { readFile, open, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  HARNESS_SCOPE,
  HARNESS_BASELINE,
  rolloutHarnessPolicy,
} from "../../showcase/scripts/rollout-harness-policy.mjs";
import { templateSha256 } from "./template-transition.mjs";

export function projectHarnessConfig(environmentConfig) {
  const service = environmentConfig.services?.[HARNESS_SCOPE.serviceId];
  assert.ok(service, "Harness configuration missing");
  assert.deepEqual(Object.keys(service).sort(), [
    "build",
    "deploy",
    "networking",
    "source",
    "variables",
  ]);
  const { variables, ...config } = service;
  return {
    ...config,
    variablesSha256: templateSha256(variables ?? {}),
    sharedVariablesSha256: templateSha256(
      environmentConfig.sharedVariables ?? {},
    ),
  };
}
function deployment(value, targetImage) {
  assert.ok(value, "Harness deployment missing");
  for (const [key, expected] of Object.entries(HARNESS_SCOPE))
    assert.equal(value[key], expected, "Harness deployment scope changed");
  assert.match(
    value.id,
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
  );
  const pending = [
    "WAITING",
    "QUEUED",
    "INITIALIZING",
    "BUILDING",
    "DEPLOYING",
  ].includes(value.status);
  assert.ok(
    pending || value.status === "SUCCESS",
    "Harness deployment failed or requires intervention",
  );
  const expectedImage =
    value.id === HARNESS_BASELINE.id ? HARNESS_BASELINE.image : targetImage;
  const digest = value.meta?.imageDigest;
  const image = value.meta?.image;
  if (!pending || digest != null) {
    assert.match(digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(
      `ghcr.io/copilotkit/showcase-harness@${digest}`,
      expectedImage,
      "Harness deployment digest differs",
    );
  }
  if (!pending || image != null) {
    assert.ok(
      image === expectedImage ||
        (value.id === HARNESS_BASELINE.id &&
          image === "ghcr.io/copilotkit/showcase-harness:latest"),
      "Harness deployment image differs",
    );
  }
  return {
    id: value.id,
    status: value.status,
    // Source metadata alone is not evidence that the provider pulled an image.
    image:
      digest == null ? null : `ghcr.io/copilotkit/showcase-harness@${digest}`,
  };
}

export function createHarnessPolicyRollout({
  graphql,
  intent,
  deadline,
  save,
  durableJournal,
  journalPath,
  operationId,
  env = process.env,
  execute = promisify(execFile),
  loadBaseline = async () =>
    JSON.parse(
      await readFile(
        new URL("./releases/harness-policy-baseline.json", import.meta.url),
      ),
    ),
}) {
  const signalFor = (signal) => {
    assert.ok(deadline > Date.now(), "Harness rollout deadline exceeded");
    return (
      signal ?? AbortSignal.timeout(Math.min(30000, deadline - Date.now()))
    );
  };
  const inspect = async (_scope, signal) => {
    assert.deepEqual(_scope, HARNESS_SCOPE);
    const value = await graphql(
      "query($e:String!,$s:String!){environment(id:$e){id projectId config(decryptVariables:false) volumeInstances(first:100){pageInfo{hasNextPage} edges{node{id serviceId environmentId volumeId mountPath}}}} environmentStagedChanges(environmentId:$e){patch(decryptVariables:false)} serviceInstance(environmentId:$e,serviceId:$s){serviceId environmentId activeDeployments{id status projectId environmentId serviceId meta} latestDeployment{id status projectId environmentId serviceId meta}}}",
      { e: HARNESS_SCOPE.environmentId, s: HARNESS_SCOPE.serviceId },
      signalFor(signal),
    );
    assert.equal(value.environment?.id, HARNESS_SCOPE.environmentId);
    assert.equal(value.environment.projectId, HARNESS_SCOPE.projectId);
    assert.equal(value.serviceInstance?.serviceId, HARNESS_SCOPE.serviceId);
    assert.equal(
      value.serviceInstance.environmentId,
      HARNESS_SCOPE.environmentId,
    );
    assert.equal(
      value.environment.volumeInstances?.pageInfo?.hasNextPage,
      false,
      "Incomplete harness volume inventory",
    );
    const latest = deployment(
      value.serviceInstance.latestDeployment,
      intent.image,
    );
    const active = value.serviceInstance.activeDeployments.map((row) =>
      deployment(row, intent.image),
    );
    assert.ok(
      active.every(
        (row) => row.id === HARNESS_BASELINE.id || row.id === latest.id,
      ),
      "Competing harness deployment",
    );
    if (latest.status === "SUCCESS")
      assert.deepEqual(
        active,
        [latest],
        "Harness active deployment differs from latest",
      );
    const patch = value.environmentStagedChanges?.patch;
    assert.ok(
      patch && typeof patch === "object",
      "Staged patch evidence missing",
    );
    return {
      ...HARNESS_SCOPE,
      config: projectHarnessConfig(value.environment.config),
      volumes: value.environment.volumeInstances.edges
        .map((edge) => edge.node)
        .filter((volume) => volume.serviceId === HARNESS_SCOPE.serviceId),
      staged: Object.keys(patch).length ? { present: true } : null,
      latestDeployment: latest,
    };
  };
  const provider = {
    inspect,
    setImage: async (scope, image, signal) => {
      assert.deepEqual(scope, HARNESS_SCOPE);
      assert.equal(image, intent.image);
      const value = await graphql(
        "mutation($s:String!,$e:String!,$input:ServiceInstanceUpdateInput!){serviceInstanceUpdate(serviceId:$s,environmentId:$e,input:$input)}",
        {
          s: scope.serviceId,
          e: scope.environmentId,
          input: { source: { image } },
        },
        signalFor(signal),
      );
      return value.serviceInstanceUpdate;
    },
    deploy: async (scope, signal) => {
      assert.deepEqual(scope, HARNESS_SCOPE);
      const value = await graphql(
        "mutation($s:String!,$e:String!){serviceInstanceDeployV2(serviceId:$s,environmentId:$e)}",
        { s: scope.serviceId, e: scope.environmentId },
        signalFor(signal),
      );
      return value.serviceInstanceDeployV2;
    },
  };
  async function persist(value, exclusive) {
    // Authoritative checkpoint lives on the retained runner volume. Only after
    // its acknowledgment may this worker mirror it or send a provider mutation.
    await durableJournal[exclusive ? "claim" : "save"](value);
    const path = exclusive ? journalPath : `${journalPath}.tmp`;
    const file = await open(path, exclusive ? "wx" : "w", 0o600);
    try {
      await file.writeFile(JSON.stringify(value));
      await file.sync();
    } finally {
      await file.close();
    }
    if (!exclusive) await rename(path, journalPath);
    const directory = await open(dirname(journalPath), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    await save(value);
  }
  return {
    async preflight(signal) {
      const state = await inspect(HARNESS_SCOPE, signal);
      const expected = structuredClone(await loadBaseline());
      assert.equal(
        templateSha256(expected),
        intent.baselineConfigSha256,
        "Reviewed harness config binding differs",
      );
      assert.deepEqual(
        state.config,
        expected,
        "Harness baseline configuration changed",
      );
      assert.deepEqual(state.volumes, []);
      assert.equal(state.staged, null);
      assert.deepEqual(state.latestDeployment, HARNESS_BASELINE);
      return {
        deployment: state.latestDeployment,
        configSha256: templateSha256(state.config),
      };
    },
    async read(signal) {
      const state = await inspect(HARNESS_SCOPE, signal);
      const baseline = structuredClone(await loadBaseline());
      baseline.source.image = intent.image;
      assert.deepEqual(
        state.config,
        baseline,
        "Harness target configuration changed",
      );
      assert.deepEqual(state.volumes, []);
      assert.equal(state.staged, null);
      return state.latestDeployment;
    },
    async rollout({ assertCandidateDrained }) {
      const baselineConfig = structuredClone(await loadBaseline());
      for (const method of ["load", "claim", "save"])
        assert.equal(
          typeof durableJournal?.[method],
          "function",
          "Retained-volume journal required",
        );
      const previousReceipt = (await durableJournal.load()) ?? undefined;
      return rolloutHarnessPolicy({
        operationId,
        targetImage: intent.image,
        baselineConfig,
        provider,
        previousReceipt,
        assertCandidateDrained,
        timeoutMs: Math.min(120000, deadline - Date.now()),
        journal: {
          claim: (value) => persist(value, true),
          save: (value) => persist(value, false),
        },
      });
    },
    async invokeReader({ deploymentId, policySha256, signal }) {
      assert.ok(
        env.RAILWAY_SSH_IDENTITY_FILE,
        "Explicit registered Railway SSH identity required",
      );
      assert.match(deploymentId, /^[a-f0-9-]{36}$/);
      assert.match(policySha256, /^[a-f0-9]{64}$/);
      assert.deepEqual(await this.read(signal), {
        id: deploymentId,
        image: intent.image,
        status: "SUCCESS",
      });
      // The command checks RAILWAY_DEPLOYMENT_ID inside the container before reading/acking.
      try {
        await execute(
          "railway",
          [
            "ssh",
            "--identity-file",
            env.RAILWAY_SSH_IDENTITY_FILE,
            "--project",
            HARNESS_SCOPE.projectId,
            "--environment",
            HARNESS_SCOPE.environmentId,
            "--service",
            HARNESS_SCOPE.serviceId,
            "--",
            "node",
            "/app/dist/validate-registry.js",
            policySha256,
            deploymentId,
          ],
          {
            env: {
              ...env,
              RAILWAY_API_TOKEN: env.RAILWAY_TOKEN,
              RAILWAY_TOKEN: undefined,
            },
            signal: signalFor(signal),
            timeout: 30000,
            maxBuffer: 65536,
          },
        );
      } catch {
        throw new Error(
          "Verified deployed harness reader failed; retain drain",
        );
      }
      assert.deepEqual(await this.read(signal), {
        id: deploymentId,
        image: intent.image,
        status: "SUCCESS",
      });
    },
  };
}
