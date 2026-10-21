import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createStack,
  stackConfiguration,
  downloadChart,
  importCandidateImages,
  verifyCandidateImports,
} from "./stack.mjs";
import { createCredentials } from "./credentials.mjs";
import { createHash } from "node:crypto";

const pins = JSON.parse(
  await readFile(new URL("./pins.json", import.meta.url)),
);

test("configuration uses pinned images and local service access without provider secrets", () => {
  const credentials = createCredentials();
  const { values, secrets } = stackConfiguration({
    pins,
    credentials,
    modelPort: 19001,
    apiPort: 19002,
  });
  assert.deepEqual(values.bootstrap.image, pins.images.migrations);
  assert.equal(
    values.appApi.env.find(({ name }) => name === "BAKED_LICENSE_KEYS_JSON")
      .value,
    credentials.publicKeys,
  );
  assert.equal(
    values.bootstrap.organizations[0].id,
    credentials.organizationId,
  );
  assert.equal(
    values.bootstrap.localEvaluation.apiKeyHash,
    credentials.apiKeyHash,
  );
  assert.equal(
    values.appApi.serviceTokens.tokens[0].organizationSlug,
    "local-evaluation",
  );
  assert.equal(
    values.learning.agent.env.find(
      ({ name }) => name === "LEARNING_AGENT_MODEL_BASE_URL",
    ).value,
    "http://host.k3d.internal:19001/v1",
  );
  assert.equal(values.learning.automation.enabled, false);
  assert.equal(values.appFrontend.enabled, false);
  assert.equal(
    secrets.find(({ metadata }) => metadata.name === "cpki-local-service")
      .stringData.token,
    credentials.serviceToken,
  );
});

test("cleanup refuses to delete a cluster with another owner", async () => {
  const calls = [];
  const stack = createStack({
    directory: "/tmp/unused",
    pins,
    modelPort: 19001,
    yaml: {},
    run: async (file, args) => {
      calls.push([file, args]);
      return "another-owner";
    },
  });
  await assert.rejects(stack.stop(), /ownership/);
  assert.equal(
    calls.some(([, args]) => args.includes("delete")),
    false,
  );
});

test("cleanup targets only its unique owned cluster and repeats safely", async () => {
  const calls = [];
  let stack;
  stack = createStack({
    directory: "/tmp/unused",
    pins,
    modelPort: 19001,
    yaml: {},
    run: async (file, args) => {
      calls.push([file, args]);
      return args[0] === "inspect" ? stack.id : "";
    },
  });
  await stack.stop();
  await stack.stop();
  assert.equal(
    calls.filter(([, args]) => args[0] === "cluster" && args[1] === "delete")
      .length,
    1,
  );
  assert.deepEqual(calls.find(([, args]) => args[1] === "delete")[1], [
    "cluster",
    "delete",
    stack.id,
  ]);
  assert.notEqual(
    stack.id,
    createStack({
      directory: "/tmp/unused",
      pins,
      modelPort: 1,
      yaml: {},
      run() {},
    }).id,
  );
});

test("chart download rejects a changed OCI manifest before writing an archive", async () => {
  const directory = await mkdtemp(join(tmpdir(), "smoke-chart-"));
  try {
    await assert.rejects(
      downloadChart(
        pins.chart,
        directory,
        async (url) =>
          new Response(
            url.includes("/token?")
              ? JSON.stringify({ token: "anonymous" })
              : "tampered",
          ),
      ),
      /digest/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("chart download verifies both OCI manifest and chart layer bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "smoke-chart-"));
  const archive = Buffer.from("verified chart bytes");
  const digest = (bytes) =>
    `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const manifest = Buffer.from(
    JSON.stringify({
      layers: [
        {
          mediaType: "application/vnd.cncf.helm.chart.content.v1.tar+gzip",
          digest: digest(archive),
        },
      ],
    }),
  );
  try {
    const path = await downloadChart(
      { ...pins.chart, digest: digest(manifest) },
      directory,
      async (url) =>
        new Response(
          url.includes("/token?")
            ? JSON.stringify({ token: "anonymous" })
            : url.includes("/manifests/")
              ? manifest
              : archive,
        ),
    );
    assert.deepEqual(await readFile(path), archive);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("start completes real chart hooks before starting services and retains private output flags", async () => {
  const directory = await mkdtemp(join(tmpdir(), "smoke-stack-"));
  const calls = [];
  const secrets = [];
  const yaml = {
    stringify: JSON.stringify,
    parseAllDocuments: (text) =>
      JSON.parse(text).map((value) => ({ toJS: () => value })),
  };
  const hooks = ["migrations", "bootstrap", "learning-queue-migration"].map(
    (name, index) => ({
      kind: "Job",
      metadata: {
        name: `cpki-${name}-1`,
        annotations: {
          "helm.sh/hook": "post-install",
          "helm.sh/hook-weight": String(5 + index * 5),
        },
      },
    }),
  );
  const digest = (bytes) =>
    `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const archive = Buffer.from("chart");
  const manifest = JSON.stringify({
    layers: [
      {
        mediaType: "application/vnd.cncf.helm.chart.content.v1.tar+gzip",
        digest: digest(archive),
      },
    ],
  });
  let stack;
  const run = async (file, args, options) => {
    calls.push({ file, args, options });
    if (options.step === "chart-render") return JSON.stringify(hooks);
    if (options.step === "cluster-discovery") return "[]";
    if (options.step === "stack-owner") return stack.id;
    if (options.step === "node-identity") return "a".repeat(64);
    if (options.step === "hook-logs" && args.includes("job/cpki-bootstrap-1"))
      return `CPKI_LOCAL_BOOTSTRAP=${JSON.stringify({ organizationId: stack.credentials.organizationId, projectId: "42", projectSlug: "local-app" })}`;
    return "";
  };
  try {
    stack = createStack({
      directory,
      pins: { ...pins, chart: { ...pins.chart, digest: digest(manifest) } },
      modelPort: 19001,
      yaml,
      run,
      secrets,
      fetch: async (url) =>
        new Response(
          url.includes("/token?")
            ? '{"token":"anonymous"}'
            : url.includes("/manifests/")
              ? manifest
              : archive,
        ),
    });
    assert.ok(secrets.includes(stack.credentials.licenseToken));
    await stack.start();
    const lastHook = calls.findLastIndex(
      ({ options }) => options.step === "hook-wait",
    );
    assert.ok(
      calls.findIndex(({ options }) => options.step === "services-start") >
        lastHook,
    );
    assert.match(stack.credentials.apiKey, /^cpk-42_/);
    assert.ok(secrets.includes(stack.credentials.apiKey));
    assert.equal(
      calls.find(({ options }) => options.step === "chart-render").options
        .sensitive,
      true,
    );
    assert.equal(
      calls.find(({ options }) => options.step === "kubeconfig").options
        .sensitive,
      true,
    );
    assert.ok(
      calls
        .find(({ options }) => options.step === "cluster-create")
        .args.includes("--kubeconfig-update-default=false"),
    );
    await stack.stop();
    const failedCalls = [];
    stack = createStack({
      directory,
      pins: { ...pins, chart: { ...pins.chart, digest: digest(manifest) } },
      modelPort: 19001,
      yaml,
      secrets,
      fetch: async (url) =>
        new Response(
          url.includes("/token?")
            ? '{"token":"anonymous"}'
            : url.includes("/manifests/")
              ? manifest
              : archive,
        ),
      run: async (file, args, options) => {
        failedCalls.push({ file, args, options });
        if (["cluster-create", "stack-owner"].includes(options.step))
          throw new Error("Docker failed before node creation");
        return run(file, args, options);
      },
    });
    await assert.rejects(stack.start(), /before node creation/);
    await stack.stop();
    assert.ok(
      failedCalls.some(
        ({ args }) =>
          args[0] === "cluster" && args[1] === "delete" && args[2] === stack.id,
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("evidence requires resolved image IDs and the expected pinned workload images", async () => {
  const directory = await mkdtemp(join(tmpdir(), "smoke-evidence-"));
  const names = [
    "app-api",
    "realtime-gateway",
    "learning-agent",
    "learning-reconciler",
  ];
  const pods = names.map((name) => {
    const image =
      name === "realtime-gateway"
        ? pins.images.realtimeGateway
        : pins.images.appApi;
    return {
      metadata: { name, labels: { "app.kubernetes.io/component": name } },
      spec: {
        containers: [{ name, image: `${image.repository}@${image.digest}` }],
      },
      status: {
        containerStatuses: [
          {
            name,
            ready: true,
            imageID: `containerd://sha256:${"a".repeat(64)}`,
          },
        ],
      },
    };
  });
  let stack;
  const run = async (_file, _args, { step }) =>
    step === "stack-owner"
      ? stack.id
      : step === "stack-pods"
        ? JSON.stringify({ items: pods })
        : "";
  try {
    stack = createStack({ directory, pins, modelPort: 1, yaml: {}, run });
    await stack.collectEvidence();
    const evidence = JSON.parse(
      await readFile(join(directory, "stack-images.json")),
    );
    assert.equal(evidence.length, 4);
    pods[0].status.containerStatuses[0].imageID = "";
    await assert.rejects(stack.collectEvidence(), /image identity/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("candidate import evidence connects loaded manifest bytes to the built image config", async () => {
  const config = { architecture: "arm64", os: "linux", config: {} };
  const bytes = JSON.stringify;
  const digest = (value) =>
    `sha256:${createHash("sha256").update(bytes(value)).digest("hex")}`;
  const manifest = {
    schemaVersion: 2,
    config: { digest: digest(config) },
    layers: [],
  };
  const index = { schemaVersion: 2, manifests: [{ digest: digest(manifest) }] };
  const image = "pe431-candidate/app-api:test";
  const candidate = {
    revision: "a".repeat(40),
    imageEvidence: [
      {
        service: "appApi",
        image,
        id: digest(config),
        revision: "a".repeat(40),
      },
    ],
  };
  const content = new Map([
    [digest(index), bytes(index)],
    [digest(manifest), bytes(manifest)],
  ]);
  const calls = [];
  const run = async (file, args) => {
    calls.push([file, args]);
    if (args.includes("list"))
      return `REF TYPE DIGEST SIZE PLATFORMS LABELS\ndocker.io/${image} application/vnd.oci.image.index.v1+json ${digest(index)} 100 linux/arm64 -\n`;
    return content.get(args.at(-1));
  };
  const result = await verifyCandidateImports({
    candidate,
    node: "k3d-test-server-0",
    run,
  });
  assert.equal(result[0].id, digest(config));
  assert.ok(result[0].verifiedDigests.includes(digest(manifest)));
  assert.ok(result[0].verifiedDigests.includes(digest(index)));
  candidate.imageEvidence[0].id = digest(index);
  const modernDocker = await verifyCandidateImports({
    candidate,
    node: "k3d-test-server-0",
    run,
  });
  assert.ok(modernDocker[0].verifiedDigests.includes(digest(manifest)));
  assert.ok(modernDocker[0].verifiedDigests.includes(digest(config)));
  assert.ok(
    calls.every(
      ([, args]) => args[0] === "exec" && args[1] === "k3d-test-server-0",
    ),
  );
  candidate.imageEvidence[0].id = `sha256:${"f".repeat(64)}`;
  await assert.rejects(
    verifyCandidateImports({ candidate, node: "k3d-test-server-0", run }),
    /built candidate/,
  );
});

test("candidate import waits for ctr in the node and surfaces its failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "candidate-import-"));
  const archive = join(directory, "candidate-images.tar");
  const node = "k3d-test-server-0";
  const candidate = { dockerImages: ["one:tag", "two:tag"] };
  const target = "/tmp/candidate-images.tar";
  try {
    for (const importFails of [false, true]) {
      const calls = [];
      const run = async (file, args, options) => {
        calls.push({ file, args, step: options.step });
        if (options.step === "candidate-save")
          await writeFile(args[args.indexOf("--output") + 1], "tar");
        if (options.step === "candidate-import" && importFails)
          throw new Error("candidate-import failed (exit 1)");
        return "";
      };
      const imported = importCandidateImages({
        candidate,
        node,
        directory,
        run,
      });
      if (importFails) await assert.rejects(imported, /candidate-import/);
      else await imported;
      assert.deepEqual(
        calls.map(({ file, args, step }) => [step, file, ...args]),
        [
          [
            "candidate-save",
            "docker",
            "image",
            "save",
            "--output",
            archive,
            ...candidate.dockerImages,
          ],
          ["candidate-copy", "docker", "cp", archive, `${node}:${target}`],
          [
            "candidate-import",
            "docker",
            "exec",
            node,
            "ctr",
            "--namespace",
            "k8s.io",
            "images",
            "import",
            "--all-platforms",
            target,
          ],
          ...(importFails
            ? []
            : [
                [
                  "candidate-import-cleanup",
                  "docker",
                  "exec",
                  node,
                  "rm",
                  "-f",
                  target,
                ],
              ]),
        ],
      );
      await assert.rejects(stat(archive), { code: "ENOENT" });
    }
    await assert.rejects(
      importCandidateImages({
        candidate,
        node,
        directory,
        run: async (_file, args, options) => {
          if (options.step === "candidate-save")
            await writeFile(args[args.indexOf("--output") + 1], "partial");
          if (options.step === "candidate-copy")
            throw new Error("candidate-copy failed (exit 1)");
          return "";
        },
      }),
      /candidate-copy/,
    );
    await assert.rejects(stat(archive), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("candidate import rejects changed content under a retained digest", async () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const candidate = {
    imageEvidence: [{ image: "pe431-candidate/app-api:test", id: digest }],
  };
  await assert.rejects(
    verifyCandidateImports({
      candidate,
      node: "k3d-test-server-0",
      run: async (_file, args) =>
        args.includes("list")
          ? `docker.io/pe431-candidate/app-api:test type ${digest} 100 linux/amd64 -`
          : "changed",
    }),
    /digest mismatch/,
  );
});

test("candidate stack imports built images, proves running identity and removes only its own tags", async () => {
  const directory = await mkdtemp(join(tmpdir(), "candidate-stack-"));
  const revision = "a".repeat(40);
  const configId = `sha256:${"b".repeat(64)}`;
  const content = JSON.stringify({ config: { digest: configId } });
  const digest = (value) =>
    `sha256:${createHash("sha256").update(value).digest("hex")}`;
  const importedDigest = digest(content);
  const archive = Buffer.from("chart");
  const manifest = JSON.stringify({
    layers: [
      {
        mediaType: "application/vnd.cncf.helm.chart.content.v1.tar+gzip",
        digest: digest(archive),
      },
    ],
  });
  const candidate = {
    revision,
    images: {},
    dockerImages: [],
    imageEvidence: [],
  };
  for (const service of ["appApi", "realtimeGateway", "migrations"]) {
    const repository = `pe431-candidate/${service.toLowerCase()}`;
    const image = `${repository}:${revision}-unique`;
    candidate.images[service] = {
      repository,
      tag: `${revision}-unique`,
      digest: "",
      pullPolicy: "Never",
    };
    candidate.dockerImages.push(image);
    candidate.imageEvidence.push({ service, image, id: configId, revision });
  }
  const hooks = ["migrations", "bootstrap", "learning-queue-migration"].map(
    (name, index) => ({
      kind: "Job",
      metadata: {
        name: `cpki-${name}-1`,
        annotations: {
          "helm.sh/hook": "post-install",
          "helm.sh/hook-weight": String(index),
        },
      },
    }),
  );
  const calls = [];
  let stack;
  let wrongRuntime = false;
  const run = async (file, args, options) => {
    calls.push({ file, args, options });
    if (options.step === "chart-render") return JSON.stringify(hooks);
    if (options.step === "cluster-discovery") return "[]";
    if (options.step === "stack-owner") return stack.id;
    if (options.step === "node-identity") return "a".repeat(64);
    if (options.step === "candidate-import-list")
      return candidate.dockerImages
        .map(
          (image) =>
            `docker.io/${image} type ${importedDigest} 100 linux/arm64 -`,
        )
        .join("\n");
    if (options.step === "candidate-import-content") return content;
    if (options.step === "hook-logs" && args.includes("job/cpki-bootstrap-1"))
      return `CPKI_LOCAL_BOOTSTRAP=${JSON.stringify({ organizationId: stack.credentials.organizationId, projectId: "42", projectSlug: "local-app" })}`;
    if (options.step === "stack-pods")
      return JSON.stringify({
        items: [
          "app-api",
          "realtime-gateway",
          "learning-agent",
          "learning-reconciler",
          "migrations",
        ].map((name) => {
          const image = candidate.imageEvidence.find(
            ({ service }) =>
              service ===
              (name === "realtime-gateway"
                ? "realtimeGateway"
                : name === "migrations"
                  ? "migrations"
                  : "appApi"),
          ).image;
          return {
            metadata: { name, labels: { "app.kubernetes.io/component": name } },
            spec: { containers: [{ name, image }] },
            status: {
              containerStatuses: [
                {
                  name,
                  ready: name !== "migrations",
                  imageID: `containerd://${wrongRuntime ? configId.replaceAll("b", "c") : importedDigest}`,
                  state:
                    name === "migrations"
                      ? { terminated: { exitCode: 0 } }
                      : { running: {} },
                },
              ],
            },
          };
        }),
      });
    return "";
  };
  try {
    stack = createStack({
      directory,
      pins: { ...pins, chart: { ...pins.chart, digest: digest(manifest) } },
      modelPort: 19001,
      intelligenceSource: "/source",
      yaml: {
        stringify: JSON.stringify,
        parseAllDocuments: (text) =>
          JSON.parse(text).map((value) => ({ toJS: () => value })),
      },
      run,
      buildCandidate: async (input) => {
        assert.equal(input.source, "/source");
        return candidate;
      },
      fetch: async (url) =>
        new Response(
          url.includes("/token?")
            ? '{"token":"anonymous"}'
            : url.includes("/manifests/")
              ? manifest
              : archive,
        ),
    });
    await stack.start();
    assert.ok(
      calls.some(
        ({ args, options }) =>
          options.step === "candidate-save" &&
          candidate.dockerImages.every((image) => args.includes(image)),
      ),
    );
    const importSteps = calls
      .map(({ options }) => options.step)
      .filter((step) => step.startsWith("candidate-"));
    assert.deepEqual(importSteps.slice(0, 4), [
      "candidate-save",
      "candidate-copy",
      "candidate-import",
      "candidate-import-cleanup",
    ]);
    assert.ok(
      importSteps.indexOf("candidate-import-list") >
        importSteps.indexOf("candidate-import"),
    );
    assert.ok(
      !calls.some(({ args }) => args[0] === "image" && args[1] === "import"),
    );
    const values = JSON.parse(await readFile(join(directory, "values.yaml")));
    assert.equal(values.appApi.image.pullPolicy, "Never");
    assert.equal(values.bootstrap.image.tag, candidate.images.migrations.tag);
    const evidence = await stack.collectEvidence();
    assert.equal(evidence.candidate.revision, revision);
    assert.ok(
      evidence.candidate.images.every((image) =>
        image.verifiedDigests.includes(importedDigest),
      ),
    );
    wrongRuntime = true;
    await assert.rejects(stack.collectEvidence(), /image identity/);
    await stack.stop();
    assert.deepEqual(
      calls
        .filter(({ args }) => args[0] === "image" && args[1] === "rm")
        .map(({ args }) => args.at(-1))
        .sort(),
      [...candidate.dockerImages].sort(),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const clusterFailure of [false, true]) {
  test(`cleanup reports all image failures and preserves cluster failure=${clusterFailure}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "cleanup-stack-"));
    const images = [
      "pe431-candidate/app-api:owned",
      "pe431-candidate/gateway:owned",
      "pe431-candidate/migrations:owned",
    ];
    const calls = [];
    let retry = false;
    let stack;
    const clusterError = new Error("cluster deletion failed");
    const imageErrors = images.map(
      (image) => new Error(`image cleanup failed: ${image}`),
    );
    const run = async (_file, args, { step }) => {
      calls.push({ args, step });
      if (step === "stack-owner") return stack.id;
      if (step === "cluster-delete" && clusterFailure && !retry)
        throw clusterError;
      if (
        step === "candidate-image-cleanup" &&
        !retry &&
        args.at(-1) !== images[1]
      )
        throw imageErrors[images.indexOf(args.at(-1))];
      return "";
    };
    try {
      stack = createStack({
        directory,
        pins,
        modelPort: 1,
        intelligenceSource: "/candidate",
        yaml: {},
        run,
        buildCandidate: async () => ({
          revision: "a".repeat(40),
          dockerImages: images,
          images: {},
          imageEvidence: [],
        }),
        fetch: async () => {
          throw new Error("stop before cluster creation");
        },
      });
      await assert.rejects(stack.start(), /stop before cluster creation/);
      await assert.rejects(stack.stop(), (error) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors.length, clusterFailure ? 3 : 2);
        assert.ok(error.errors.includes(imageErrors[0]));
        assert.ok(error.errors.includes(imageErrors[2]));
        if (clusterFailure) assert.ok(error.errors.includes(clusterError));
        return true;
      });
      assert.deepEqual(
        calls
          .filter(({ step }) => step === "candidate-image-cleanup")
          .map(({ args }) => args.at(-1)),
        images,
      );
      retry = true;
      await stack.stop();
      await stack.stop();
      assert.deepEqual(
        calls
          .filter(({ step }) => step === "candidate-image-cleanup")
          .map(({ args }) => args.at(-1)),
        [...images, images[0], images[2]],
      );
      assert.equal(
        calls.filter(({ step }) => step === "cluster-delete").length,
        clusterFailure ? 2 : 1,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
