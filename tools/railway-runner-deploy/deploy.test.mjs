import assert from "node:assert/strict";
import test from "node:test";
import { deployReviewedRunner } from "./deploy.mjs";

const identity = (c) => ({
  protocolVersion: 1,
  sourceRevision: c.repeat(40),
  sourceManifestSha256: c.repeat(64),
  compatibilitySha256: "c".repeat(64),
  policySha256:
    "7eb39aa628b77c30efa88a00c4ad0695de89ac2bb919e7e25f550a4ab2f2c765",
});
const image = (c) =>
  `ghcr.io/copilotkit/rich-thread-runner@sha256:${c.repeat(64)}`;
function setup(same = false) {
  const baseline = { image: image("a"), runtimeIdentity: identity("a") };
  const candidate = same
    ? structuredClone(baseline)
    : { image: image("b"), runtimeIdentity: identity("b") };
  const release = { baseline, candidate };
  let current = baseline,
    deploymentId = "old",
    configuredImage = baseline.image,
    now = 0;
  const calls = [],
    receipts = [];
  const state = {
    protocolVersion: 1,
    runtimeIdentity: baseline.runtimeIdentity,
    templateSha256: "d".repeat(64),
    operation: null,
    phase: "running",
    busy: false,
    active: null,
    blocked: false,
  };
  const railway = {
    inspect: async () => ({
      configuredImage,
      active: { id: deploymentId, image: current.image, status: "SUCCESS" },
      latest: { id: deploymentId, status: "SUCCESS", image: current.image },
      volumeId: "2a70e47d-85d4-4a8a-b17b-b6788c91b1c7",
      volumeInstanceId: "f3187181-2fb7-4d3e-a9dc-c80eac894895",
      mountPath: "/data",
    }),
    setImage: async (value) => {
      calls.push(["image", value]);
      configuredImage = value;
    },
    deploy: async () => {
      calls.push(["deploy"]);
      deploymentId = `new-${calls.length}`;
      current = configuredImage === candidate.image ? candidate : baseline;
      state.runtimeIdentity = current.runtimeIdentity;
      return deploymentId;
    },
    deployment: async (id) => ({ id, status: "SUCCESS" }),
  };
  const runner = {
    get: async () => structuredClone(state),
    drain: async ({ operationId, targetIdentity }) => {
      calls.push(["drain"]);
      state.operation = {
        version: 1,
        status: "drained",
        operationId,
        baselineIdentity: baseline.runtimeIdentity,
        targetIdentity,
        templateSha256: state.templateSha256,
      };
      state.phase = "drained";
    },
    resume: async () => {
      calls.push(["resume"]);
      state.operation.status = "resumed";
      state.phase = "running";
    },
  };
  const options = {
    release,
    provenance: {
      releaseSha256: "f".repeat(64),
      run: {
        id: 123,
        attempt: 1,
        sha: "1".repeat(40),
        workflowPath: ".github/workflows/intelligence-rich-threads-deploy.yml",
        workflowSha256: "2".repeat(64),
      },
    },
    operationId: "github-655515393-123",
    runner,
    railway,
    clock: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    deadline: 100000,
    receipt: async (value) => receipts.push(structuredClone(value)),
  };
  return {
    options,
    calls,
    receipts,
    state,
    railway,
    runner,
    baseline,
    candidate,
  };
}
test("distinct candidate drains, changes only image, redeploys and resumes with verified receipt", async () => {
  const h = setup();
  const result = await deployReviewedRunner(h.options);
  assert.equal(result.outcome, "deployed");
  assert.equal(result.finalState.verified, true);
  assert.equal(result.finalState.image, h.candidate.image);
  assert.deepEqual(
    h.calls.map((x) => x[0]),
    ["drain", "image", "deploy", "resume"],
  );
});
test("same-image bootstrap still creates a new deployment", async () => {
  const h = setup(true);
  const result = await deployReviewedRunner(h.options);
  assert.notEqual(result.finalState.deploymentId, "old");
  assert.equal(h.calls.filter((x) => x[0] === "deploy").length, 1);
});
for (const change of ["volume", "configured", "owner", "template", "busy"])
  test(`refuses unsafe ${change} state without image mutation`, async () => {
    const h = setup();
    if (change === "volume") {
      const inspect = h.railway.inspect;
      h.railway.inspect = async () => ({
        ...(await inspect()),
        volumeInstanceId: "other",
      });
    }
    if (change === "configured") {
      const inspect = h.railway.inspect;
      h.railway.inspect = async () => ({
        ...(await inspect()),
        configuredImage: h.candidate.image,
      });
    }
    if (change === "owner") {
      h.state.operation = { operationId: "other", status: "drained" };
      h.state.phase = "drained";
    }
    if (change === "template") {
      const drain = h.runner.drain;
      h.runner.drain = async (x) => {
        await drain(x);
        h.state.templateSha256 = "e".repeat(64);
      };
    }
    if (change === "busy") {
      const drain = h.runner.drain;
      h.runner.drain = async (x) => {
        await drain(x);
        h.state.busy = true;
      };
    }
    await assert.rejects(deployReviewedRunner(h.options));
    assert.equal(h.calls.filter((x) => x[0] === "image").length, 0);
  });
test("unknown deployment outcome keeps drain and never rolls back or resumes", async () => {
  const h = setup();
  h.railway.deployment = async () => {
    throw new Error("secret network response");
  };
  await assert.rejects(deployReviewedRunner(h.options));
  assert.equal(h.calls.filter((x) => x[0] === "resume").length, 0);
  assert.equal(h.calls.filter((x) => x[0] === "image").length, 1);
  assert.equal(h.receipts.at(-1).outcome, "unknown");
  assert.equal(JSON.stringify(h.receipts).includes("secret"), false);
});
test("known candidate failure restores verified baseline and reports rollback as failure", async () => {
  const h = setup();
  let n = 0;
  let failed = false;
  const inspect = h.railway.inspect;
  h.railway.inspect = async () => {
    const value = await inspect();
    return failed
      ? {
          ...value,
          active: null,
          latest: { ...value.latest, status: "FAILED" },
        }
      : value;
  };
  h.railway.deployment = async (id) => {
    failed = ++n === 1;
    return { id, status: failed ? "FAILED" : "SUCCESS" };
  };
  await assert.rejects(deployReviewedRunner(h.options), /rolled back/);
  assert.equal(h.receipts.at(-1).outcome, "rolled-back");
  assert.equal(h.receipts.at(-1).finalState.image, h.baseline.image);
  assert.equal(h.calls.filter((x) => x[0] === "resume").length, 1);
});
test("same operation at completed candidate is idempotent", async () => {
  const h = setup();
  await deployReviewedRunner(h.options);
  const count = h.calls.length;
  await deployReviewedRunner(h.options);
  assert.equal(h.calls.length, count);
});
test("completed rollback is not silently reported as success", async () => {
  const h = setup();
  await h.runner.drain({
    operationId: h.options.operationId,
    targetIdentity: h.candidate.runtimeIdentity,
  });
  await h.runner.resume();
  await assert.rejects(deployReviewedRunner(h.options), /rolled back/);
  assert.equal(h.calls.filter((x) => x[0] === "image").length, 0);
});
test("same owner can continue after configured image update before deploy", async () => {
  const h = setup();
  await h.runner.drain({
    operationId: h.options.operationId,
    targetIdentity: h.candidate.runtimeIdentity,
  });
  await h.railway.setImage(h.candidate.image);
  const result = await deployReviewedRunner(h.options);
  assert.equal(result.outcome, "deployed");
});
test("rollback failure never resumes and retains unknown receipt", async () => {
  const h = setup();
  let failed = false;
  const inspect = h.railway.inspect;
  h.railway.inspect = async () => {
    const state = await inspect();
    return failed
      ? {
          ...state,
          active: null,
          latest: { ...state.latest, status: "FAILED" },
        }
      : state;
  };
  h.railway.deployment = async (id) => {
    failed = true;
    return { id, status: "FAILED" };
  };
  await assert.rejects(deployReviewedRunner(h.options));
  assert.equal(h.calls.filter((x) => x[0] === "resume").length, 0);
  assert.equal(h.receipts.at(-1).finalState.verified, false);
});
test("candidate drain rerun verifies and resumes without deploying twice", async () => {
  const h = setup();
  await h.runner.drain({
    operationId: h.options.operationId,
    targetIdentity: h.candidate.runtimeIdentity,
  });
  await h.railway.setImage(h.candidate.image);
  await h.railway.deploy();
  const count = h.calls.filter((x) => x[0] === "deploy").length;
  await deployReviewedRunner(h.options);
  assert.equal(h.calls.filter((x) => x[0] === "deploy").length, count);
  assert.equal(h.state.phase, "running");
});
test("blocked cleanup remains fenced until deadline", async () => {
  const h = setup();
  const drain = h.runner.drain;
  h.runner.drain = async (x) => {
    await drain(x);
    h.state.phase = "draining";
    h.state.blocked = true;
  };
  await assert.rejects(deployReviewedRunner(h.options), /deadline/);
  assert.equal(
    h.calls.filter((x) => ["image", "resume"].includes(x[0])).length,
    0,
  );
});
test("same-image completed rerun refuses ambiguous redeploy evidence", async () => {
  const h = setup(true);
  await deployReviewedRunner(h.options);
  await assert.rejects(deployReviewedRunner(h.options), /fresh dispatch/);
});
test("a newly admitted manual run after resume does not invalidate deployment proof", async () => {
  const h = setup();
  const resume = h.runner.resume;
  h.runner.resume = async () => {
    await resume();
    h.state.busy = true;
    h.state.active = { id: "manual-run" };
  };
  const result = await deployReviewedRunner(h.options);
  assert.equal(result.finalState.verified, true);
});

test("lost deploy response can recover a failed candidate using the live original drain owner", async () => {
  const h = setup();
  let lost = true;
  const originalInspect = h.railway.inspect;
  const originalDeploy = h.railway.deploy;
  h.railway.deploy = async () => {
    if (lost) throw new Error("response lost");
    return originalDeploy();
  };
  await assert.rejects(deployReviewedRunner(h.options));
  const previousCheckpoint = h.receipts.at(-1).checkpoint;
  h.railway.inspect = async () => {
    const value = await originalInspect();
    return lost
      ? {
          ...value,
          latest: {
            id: "failed-candidate",
            status: "FAILED",
            image: h.candidate.image,
          },
        }
      : value;
  };
  h.railway.deploy = async () => {
    lost = false;
    return originalDeploy();
  };
  await assert.rejects(
    deployReviewedRunner({ ...h.options, previousCheckpoint }),
    /rolled back/,
  );
  assert.equal(h.receipts.at(-1).outcome, "rolled-back");
  assert.equal(h.receipts.at(-1).finalState.image, h.baseline.image);
});
test("definite startup failure rolls back from saved drain proof without candidate HTTP or active deployment", async () => {
  const h = setup();
  let failed = false;
  const originalInspect = h.railway.inspect;
  const originalGet = h.runner.get;
  const originalDeploy = h.railway.deploy;
  h.railway.deployment = async (id) => {
    if (failed) return { id, status: "FAILED" };
    return { id, status: "SUCCESS" };
  };
  h.railway.deploy = async () => {
    const id = await originalDeploy();
    failed = h.state.runtimeIdentity === h.candidate.runtimeIdentity;
    return id;
  };
  h.railway.inspect = async () => {
    const value = await originalInspect();
    return failed
      ? {
          ...value,
          active: null,
          latest: {
            ...value.latest,
            status: "FAILED",
            image: h.candidate.image,
          },
        }
      : value;
  };
  h.runner.get = async () => {
    if (failed) throw new Error("runner unavailable");
    return originalGet();
  };
  await assert.rejects(deployReviewedRunner(h.options), /rolled back/);
  assert.equal(h.receipts.at(-1).finalState.image, h.baseline.image);
});
test("rerun uses exact prior candidate ID checkpoint when failed runner is unavailable", async () => {
  const h = setup();
  let interrupted = true;
  let failed = true;
  const originalInspect = h.railway.inspect;
  const originalGet = h.runner.get;
  const originalDeploy = h.railway.deploy;
  h.railway.deployment = async (id) => {
    if (interrupted) throw new Error("poll network lost");
    return { id, status: "SUCCESS" };
  };
  await assert.rejects(deployReviewedRunner(h.options));
  const previousCheckpoint = h.receipts.at(-1).checkpoint;
  interrupted = false;
  h.railway.inspect = async () => {
    const value = await originalInspect();
    return failed
      ? {
          ...value,
          active: null,
          latest: {
            ...value.latest,
            status: "FAILED",
            image: h.candidate.image,
          },
        }
      : value;
  };
  h.runner.get = async () => {
    if (failed) throw new Error("runner unavailable");
    return originalGet();
  };
  h.railway.deploy = async () => {
    failed = false;
    return originalDeploy();
  };
  await assert.rejects(
    deployReviewedRunner({ ...h.options, previousCheckpoint }),
    /rolled back/,
  );
  assert.equal(h.receipts.at(-1).outcome, "rolled-back");
});
test("rollback response loss resumes baseline on rerun without deploying candidate again", async () => {
  const h = setup();
  let failed = false;
  let rollbackLost = false;
  const inspect = h.railway.inspect;
  const deploy = h.railway.deploy;
  h.railway.deployment = async (id) => ({
    id,
    status: failed ? "FAILED" : "SUCCESS",
  });
  h.railway.inspect = async () => {
    const state = await inspect();
    return failed
      ? {
          ...state,
          active: null,
          latest: {
            ...state.latest,
            status: "FAILED",
            image: h.candidate.image,
          },
        }
      : state;
  };
  h.railway.deploy = async () => {
    const id = await deploy();
    if (h.state.runtimeIdentity === h.candidate.runtimeIdentity) {
      failed = true;
      return id;
    }
    failed = false;
    rollbackLost = true;
    throw new Error("rollback response lost");
  };
  await assert.rejects(deployReviewedRunner(h.options));
  assert.equal(rollbackLost, true);
  const previousCheckpoint = h.receipts.at(-1).checkpoint;
  const count = h.calls.filter((x) => x[0] === "deploy").length;
  await assert.rejects(
    deployReviewedRunner({ ...h.options, previousCheckpoint }),
    /rolled back/,
  );
  assert.equal(h.calls.filter((x) => x[0] === "deploy").length, count);
  assert.equal(h.receipts.at(-1).outcome, "rolled-back");
});
test("unknown candidate ID with unavailable runner never permits rollback", async () => {
  const h = setup();
  h.railway.deploy = async () => {
    throw new Error("deploy response lost");
  };
  await assert.rejects(deployReviewedRunner(h.options));
  const previousCheckpoint = h.receipts.at(-1).checkpoint;
  const inspect = h.railway.inspect;
  h.railway.inspect = async () => ({
    ...(await inspect()),
    active: null,
    latest: { id: "unknown", status: "FAILED", image: h.candidate.image },
  });
  h.runner.get = async () => {
    throw new Error("runner unavailable");
  };
  const mutations = h.calls.filter((x) => x[0] === "image").length;
  await assert.rejects(
    deployReviewedRunner({ ...h.options, previousCheckpoint }),
  );
  assert.equal(h.calls.filter((x) => x[0] === "image").length, mutations);
});
test("saved failed-candidate checkpoint cannot override a reachable different drain owner", async () => {
  const h = setup();
  h.railway.deployment = async () => {
    throw new Error("poll interrupted");
  };
  await assert.rejects(deployReviewedRunner(h.options));
  const previousCheckpoint = h.receipts.at(-1).checkpoint;
  const inspect = h.railway.inspect;
  h.railway.inspect = async () => {
    const state = await inspect();
    return {
      ...state,
      active: null,
      latest: { ...state.latest, status: "FAILED", image: h.candidate.image },
    };
  };
  h.state.operation.operationId = "github-655515393-999";
  h.runner.probe = async () => structuredClone(h.state);
  const count = h.calls.length;
  await assert.rejects(
    deployReviewedRunner({ ...h.options, previousCheckpoint }),
    /owner/,
  );
  assert.equal(h.calls.length, count);
});
test("removed deployment is not treated as a known startup failure for automatic rollback", async () => {
  const h = setup();
  let removed = false;
  const inspect = h.railway.inspect;
  const deploy = h.railway.deploy;
  h.railway.deploy = async () => {
    const id = await deploy();
    removed = true;
    return id;
  };
  h.railway.deployment = async (id) => ({ id, status: "REMOVED" });
  h.railway.inspect = async () => {
    const state = await inspect();
    return removed
      ? {
          ...state,
          active: null,
          latest: {
            ...state.latest,
            status: "REMOVED",
            image: h.candidate.image,
          },
        }
      : state;
  };
  await assert.rejects(deployReviewedRunner(h.options));
  assert.equal(h.calls.filter((x) => x[0] === "image").length, 1);
  assert.equal(h.calls.filter((x) => x[0] === "resume").length, 0);
});
test("recorded candidate ID rejects a different successful deployment of the same image", async () => {
  const h = setup();
  h.railway.deployment = async () => {
    throw new Error("poll interrupted");
  };
  await assert.rejects(deployReviewedRunner(h.options));
  const previousCheckpoint = h.receipts.at(-1).checkpoint;
  const inspect = h.railway.inspect;
  h.railway.inspect = async () => {
    const state = await inspect();
    return {
      ...state,
      active: { ...state.active, id: "replacement" },
      latest: { ...state.latest, id: "replacement" },
    };
  };
  const count = h.calls.length;
  await assert.rejects(
    deployReviewedRunner({ ...h.options, previousCheckpoint }),
    /identity/,
  );
  assert.equal(h.calls.length, count);
});
test("rollback source update response loss continues exact baseline restoration without candidate HTTP", async () => {
  const h = setup();
  let failed = false;
  let loseUpdate = true;
  const inspect = h.railway.inspect;
  const deploy = h.railway.deploy;
  const setImage = h.railway.setImage;
  const get = h.runner.get;
  h.railway.deploy = async () => {
    const id = await deploy();
    failed = h.state.runtimeIdentity === h.candidate.runtimeIdentity;
    return id;
  };
  h.railway.deployment = async (id) => ({
    id,
    status: failed ? "FAILED" : "SUCCESS",
  });
  h.railway.inspect = async () => {
    const state = await inspect();
    return failed
      ? {
          ...state,
          active: null,
          latest: {
            ...state.latest,
            status: "FAILED",
            image: h.candidate.image,
          },
        }
      : state;
  };
  h.railway.setImage = async (targetImage) => {
    await setImage(targetImage);
    if (targetImage === h.baseline.image && loseUpdate)
      throw new Error("rollback update response lost");
  };
  h.runner.get = async () => {
    if (failed) throw new Error("runner unavailable");
    return get();
  };
  await assert.rejects(deployReviewedRunner(h.options));
  const previousCheckpoint = h.receipts.at(-1).checkpoint;
  assert.equal(previousCheckpoint.stage, "rollback-requested");
  loseUpdate = false;
  await assert.rejects(
    deployReviewedRunner({ ...h.options, previousCheckpoint }),
    /rolled back/,
  );
  assert.equal(h.receipts.at(-1).finalState.image, h.baseline.image);
});

for (const [boundary, timing] of [
  ["drain", "before"],
  ["drain", "after"],
  ["candidate-image", "before"],
  ["candidate-image", "after"],
  ["candidate-deploy", "before"],
  ["rollback-image", "before"],
  ["rollback-deploy", "before"],
  ["resume", "before"],
  ["resume", "after"],
])
  test(`interruption matrix: ${boundary} ${timing}, offline rerun retains authority until online proof`, async () => {
    const h = setup();
    const rollback = boundary.startsWith("rollback");
    const original = {
      inspect: h.railway.inspect,
      deploy: h.railway.deploy,
      setImage: h.railway.setImage,
      drain: h.runner.drain,
      resume: h.runner.resume,
      get: h.runner.get,
    };
    let configured = h.baseline.image,
      faulted = false,
      offline = false;
    const interrupt = async (name, action) => {
      if (name !== boundary || faulted) return action();
      faulted = true;
      if (timing === "after") await action();
      throw new Error("simulated response loss");
    };
    h.runner.drain = (body) => interrupt("drain", () => original.drain(body));
    h.runner.resume = (body) =>
      interrupt("resume", () => original.resume(body));
    h.railway.setImage = (target) =>
      interrupt(
        target === h.candidate.image ? "candidate-image" : "rollback-image",
        async () => {
          configured = target;
          return original.setImage(target);
        },
      );
    h.railway.deploy = () =>
      interrupt(
        configured === h.candidate.image
          ? "candidate-deploy"
          : "rollback-deploy",
        () => original.deploy(),
      );
    h.railway.deployment = async (id) => ({
      id,
      status:
        rollback && configured === h.candidate.image ? "FAILED" : "SUCCESS",
    });
    h.railway.inspect = async (options) => {
      const state = await original.inspect(options);
      return rollback && state.latest.image === h.candidate.image
        ? {
            ...state,
            active: null,
            latest: { ...state.latest, status: "FAILED" },
          }
        : state;
    };
    h.runner.get = async () => {
      if (offline) throw new Error("runner unavailable");
      return original.get();
    };
    h.runner.probe = async () => (offline ? null : original.get());
    await assert.rejects(deployReviewedRunner(h.options));
    assert.equal(faulted, true);
    const firstCheckpoint = h.receipts.at(-1).checkpoint;
    const resumes = h.calls.filter((call) => call[0] === "resume").length;
    offline = true;
    await assert.rejects(
      deployReviewedRunner({
        ...h.options,
        previousCheckpoint: firstCheckpoint,
      }),
    );
    assert.equal(
      h.calls.filter((call) => call[0] === "resume").length,
      resumes,
      "offline retry must not resume admission",
    );
    const retained = h.receipts.at(-1).checkpoint;
    if (firstCheckpoint)
      assert.ok(retained, "offline failure must retain recovery proof");
    offline = false;
    const recovery = deployReviewedRunner({
      ...h.options,
      previousCheckpoint: retained,
    });
    if (rollback) await assert.rejects(recovery, /rolled back/);
    else await recovery;
    const final = h.receipts.at(-1);
    assert.equal(final.finalState.verified, true);
    assert.equal(final.outcome, rollback ? "rolled-back" : "deployed");
    assert.equal(
      final.finalState.deploymentId,
      (await original.inspect()).active.id,
    );
    for (const [kind, target] of h.calls)
      if (kind === "image")
        assert.ok([h.baseline.image, h.candidate.image].includes(target));
  });
test("saved original baseline ID rejects an unexplained replacement before candidate deploy", async () => {
  const h = setup();
  h.railway.setImage = async () => {
    throw new Error("source update interrupted");
  };
  await assert.rejects(deployReviewedRunner(h.options));
  const previousCheckpoint = h.receipts.at(-1).checkpoint;
  const inspect = h.railway.inspect;
  h.railway.inspect = async () => {
    const state = await inspect();
    return {
      ...state,
      active: { ...state.active, id: "replacement-baseline" },
      latest: { ...state.latest, id: "replacement-baseline" },
    };
  };
  await assert.rejects(
    deployReviewedRunner({ ...h.options, previousCheckpoint }),
    /identity/,
  );
});
