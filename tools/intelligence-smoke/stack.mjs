import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { createCredentials } from "./credentials.mjs";
import { buildCandidate } from "./candidate.mjs";

const dependency = ({ repository, digest }) => ({
  registry: repository.slice(0, repository.indexOf("/")),
  repository: repository.slice(repository.indexOf("/") + 1),
  digest,
  tag: "",
});
const secret = (name, stringData) => ({
  apiVersion: "v1",
  kind: "Secret",
  metadata: { name },
  type: "Opaque",
  stringData,
});
const imageReference = (image) =>
  image.digest
    ? `${image.repository}@${image.digest}`
    : `${image.repository}:${image.tag}`;

/**
 * Load candidate images into the node's containerd and wait for `ctr` to exit.
 * `k3d image import` is avoided: it can report success before `ctr` has even
 * started, because it reads Docker's not-yet-set exec exit code as 0, and then
 * deletes the tarball under the pending import.
 */
export async function importCandidateImages({
  candidate,
  node,
  directory,
  run,
}) {
  const archive = join(directory, "candidate-images.tar");
  const target = "/tmp/candidate-images.tar";
  try {
    await run(
      "docker",
      ["image", "save", "--output", archive, ...candidate.dockerImages],
      { step: "candidate-save", timeoutMs: 600_000 },
    );
    await run("docker", ["cp", archive, `${node}:${target}`], {
      step: "candidate-copy",
      timeoutMs: 600_000,
    });
  } finally {
    await rm(archive, { force: true });
  }
  // Same flags as k3d, so attestation manifests stay inspectable.
  await run(
    "docker",
    [
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
    { step: "candidate-import", timeoutMs: 600_000 },
  );
  // A failed import leaves the tarball to the cluster deletion in stop().
  await run("docker", ["exec", node, "rm", "-f", target], {
    step: "candidate-import-cleanup",
    timeoutMs: 60_000,
  });
}

/** Match imported content to Docker's config, manifest, or index image identity. */
export async function verifyCandidateImports({ candidate, node, run }) {
  const ctr = (args, step) =>
    run("docker", ["exec", node, "ctr", "--namespace", "k8s.io", ...args], {
      step,
    });
  const listing = await ctr(["images", "list"], "candidate-import-list");
  const targets = new Map(
    listing
      .trim()
      .split("\n")
      .map((line) => {
        const [name, , digest] = line.trim().split(/\s+/);
        return [name, digest];
      }),
  );
  const inspect = async (digest, builtId, depth = 0, trustedParent = false) => {
    if (depth > 3 || !/^sha256:[a-f0-9]{64}$/.test(digest ?? ""))
      throw new Error("Invalid imported candidate manifest");
    const raw = await ctr(
      ["content", "get", digest],
      "candidate-import-content",
    );
    // ctr returns content bytes without a trailing formatting newline.
    if (`sha256:${createHash("sha256").update(raw).digest("hex")}` !== digest)
      throw new Error("Imported candidate content digest mismatch");
    const manifest = JSON.parse(raw);
    const matched = trustedParent || digest === builtId;
    if (matched) {
      const descendants = [digest];
      if (/^sha256:[a-f0-9]{64}$/.test(manifest.config?.digest ?? ""))
        descendants.push(manifest.config.digest);
      for (const child of manifest.manifests ?? [])
        descendants.push(
          ...(await inspect(child.digest, builtId, depth + 1, true)),
        );
      return descendants;
    }
    if (manifest.config?.digest === builtId) return [digest, builtId];
    for (const child of manifest.manifests ?? []) {
      const matches = await inspect(child.digest, builtId, depth + 1);
      if (matches.length) return [digest, ...matches];
    }
    return [];
  };
  const evidence = [];
  for (const built of candidate.imageEvidence) {
    const target =
      targets.get(built.image) ?? targets.get(`docker.io/${built.image}`);
    if (!target)
      throw new Error(`Imported built candidate is missing: ${built.service}`);
    const verifiedDigests = await inspect(target, built.id);
    if (!verifiedDigests.length)
      throw new Error(
        `Imported manifest does not match built candidate: ${built.service}`,
      );
    evidence.push({ ...built, targetDigest: target, verifiedDigests });
  }
  return evidence;
}

/** Use only public GHCR blobs and verify the pinned manifest and chart layer. */
export async function downloadChart(chart, directory, request = fetch) {
  if (
    chart.reference !== "oci://ghcr.io/copilotkit/charts/intelligence" ||
    !/^sha256:[a-f0-9]{64}$/.test(chart.digest)
  )
    throw new Error("Invalid pinned chart reference");
  const get = async (url, headers) => {
    const response = await request(url, {
      headers,
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok)
      throw new Error(`Public chart download failed: HTTP ${response.status}`);
    return response;
  };
  const { token } = await (
    await get(
      "https://ghcr.io/token?service=ghcr.io&scope=repository:copilotkit/charts/intelligence:pull",
    )
  ).json();
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.oci.image.manifest.v1+json",
  };
  const base = "https://ghcr.io/v2/copilotkit/charts/intelligence";
  const checked = async (path, digest) => {
    const bytes = Buffer.from(
      await (await get(`${base}/${path}/${digest}`, headers)).arrayBuffer(),
    );
    if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== digest)
      throw new Error("Public chart digest mismatch");
    return bytes;
  };
  const manifest = JSON.parse(await checked("manifests", chart.digest));
  const layer = manifest.layers?.find(
    ({ mediaType }) =>
      mediaType === "application/vnd.cncf.helm.chart.content.v1.tar+gzip",
  );
  if (!layer || !/^sha256:[a-f0-9]{64}$/.test(layer.digest))
    throw new Error("Public chart content layer is missing");
  const archive = await checked("blobs", layer.digest);
  const path = join(directory, "intelligence.tgz");
  await writeFile(path, archive, { mode: 0o600 });
  return path;
}

/** Reuse the CLI local-evaluation chart contract with generated test credentials. */
export function stackConfiguration({
  pins,
  credentials: c,
  modelPort,
  apiPort,
}) {
  const images = pins.images;
  return {
    values: {
      global: {
        imageRegistry: "",
        intelligenceImageRegistry: "",
        security: { allowInsecureImages: true },
      },
      auth: {
        deploymentMode: "self_hosted",
        issuer: "http://localhost:1",
        existingSecret: "cpki-local-auth",
      },
      config: {
        appFrontendOrigin: `http://localhost:${apiPort}`,
        publicAppOrigin: `http://localhost:${apiPort}`,
      },
      appFrontend: { enabled: false },
      appApi: {
        image: images.appApi,
        licenseSecret: {
          existingSecret: "cpki-local-license",
          key: "license-token",
        },
        serviceTokens: {
          enabled: true,
          tokens: [
            {
              name: "local-installer",
              organizationSlug: "local-evaluation",
              secret: { name: "cpki-local-service", key: "token" },
            },
          ],
        },
        env: [
          { name: "BAKED_LICENSE_KEYS_JSON", value: c.publicKeys },
          { name: "FF_MANAGED_CHANNELS", value: "false" },
        ],
      },
      realtimeGateway: {
        image: images.realtimeGateway,
        existingSecret: "cpki-local-gateway",
        beam: {
          cookieSecret: { name: "cpki-local-cookie", key: "release-cookie" },
        },
        env: [{ name: "FF_MANAGED_CHANNELS", value: "false" }],
      },
      migrations: { image: images.migrations },
      postgresql: {
        image: dependency(images.postgresql),
        auth: { password: c.database, postgresPassword: c.databaseAdmin },
      },
      "redis-subchart": {
        image: dependency(images.redis),
        auth: { password: c.redis },
      },
      localObjectStorage: {
        image: images.objectStorage,
        initImage: images.objectStorageInit,
      },
      bootstrap: {
        enabled: true,
        image: images.migrations,
        organizations: [
          {
            id: c.organizationId,
            slug: "local-evaluation",
            name: "Public smoke",
            mappings: [],
          },
        ],
        platformAdminMappings: [],
        emergencyPlatformAdminGrants: [],
        localEvaluation: {
          organizationSlug: "local-evaluation",
          projectSlug: "local-app",
          projectName: "Public smoke",
          apiKeyShort: c.apiKeyShort,
          apiKeyHash: c.apiKeyHash,
        },
      },
      learning: {
        enabled: true,
        globalEnabled: true,
        automation: { enabled: false },
        agent: {
          model: "compatible/smoke-model",
          tokenSecret: {
            existingSecret: "cpki-local-learning",
            key: "learning-agent-token",
          },
          env: [
            {
              name: "LEARNING_AGENT_MODEL_BASE_URL",
              value: `http://host.k3d.internal:${modelPort}/v1`,
            },
            {
              name: "LEARNING_AGENT_MODEL_API_KEY",
              value: "public-smoke-placeholder",
            },
          ],
        },
      },
    },
    secrets: [
      secret("cpki-local-auth", {
        "auth-secret": c.session,
        "auth-client-id": "public-smoke",
        "auth-client-secret": c.oidcClient,
      }),
      secret("cpki-local-license", { "license-token": c.licenseToken }),
      secret("cpki-local-service", { token: c.serviceToken }),
      secret("cpki-local-learning", {
        "learning-agent-token": c.learningToken,
      }),
      secret("cpki-local-object-storage", {
        "s3-access-key": c.objectAccess,
        "s3-secret-key": c.objectSecret,
      }),
      secret("cpki-local-gateway", {
        "runner-auth-secret": c.gatewayRunner,
        "secret-key-base": c.gatewaySession,
      }),
      secret("cpki-local-cookie", { "release-cookie": c.beamCookie }),
    ],
  };
}

/** Reserve a free loopback port while choosing the other stack ports. */
async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    port: server.address().port,
    release: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

/** Start and clean up one disposable k3d stack, using the real published Helm hooks. */
export function createStack({
  directory,
  output = directory,
  pins,
  modelPort,
  k3d = "k3d",
  helm = "helm",
  yaml,
  run,
  secrets = [],
  fetch: request = fetch,
  intelligenceSource,
  buildCandidate: build = buildCandidate,
}) {
  const id = `cpki-smoke-${randomUUID().slice(0, 12)}`;
  const node = `k3d-${id}-server-0`;
  const credentials = createCredentials();
  const secretValues = secrets;
  secretValues.push(
    ...Object.values(credentials).filter((value) => typeof value === "string"),
  );
  let apiPort;
  let gatewayPort;
  let stopped = false;
  let clusterRemoved = false;
  const removedImages = new Set();
  let creationAttempted = false;
  let candidate;
  let candidateImages = [];
  let effectivePins = pins;
  const candidateEvidence = () =>
    candidate
      ? {
          revision: candidate.revision,
          images: candidateImages.length
            ? candidateImages
            : candidate.imageEvidence,
        }
      : null;
  const cleanCandidate = async () => {
    const errors = [];
    for (const image of candidate?.dockerImages ?? []) {
      if (removedImages.has(image)) continue;
      try {
        await run("docker", ["image", "rm", image], {
          step: "candidate-image-cleanup",
          timeoutMs: 60_000,
        });
        removedImages.add(image);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, "Candidate image cleanup failed");
  };
  const kube = (args, step, input) =>
    run("docker", ["exec", "-i", node, "kubectl", ...args], {
      step,
      input,
      timeoutMs: 660_000,
    });
  const owned = async () => {
    const owner = (
      await run(
        "docker",
        [
          "inspect",
          "--format",
          '{{index .Config.Labels "copilotkit.smoke-stack"}}',
          node,
        ],
        { step: "stack-owner", timeoutMs: 15_000 },
      )
    ).trim();
    if (owner !== id)
      throw new Error(
        "Stack ownership mismatch; refusing to operate on this container",
      );
  };
  return {
    id,
    credentials,
    secretValues,
    get candidateEvidence() {
      return candidateEvidence();
    },
    get apiUrl() {
      return apiPort ? `http://localhost:${apiPort}` : undefined;
    },
    get gatewayUrl() {
      return gatewayPort ? `ws://localhost:${gatewayPort}` : undefined;
    },
    async start() {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      if (intelligenceSource) {
        candidate = await build({ source: intelligenceSource, directory, run });
        effectivePins = {
          ...pins,
          images: { ...pins.images, ...candidate.images },
        };
        await writeFile(
          join(output, "candidate-images.json"),
          JSON.stringify(candidateEvidence(), null, 2),
          { mode: 0o600 },
        );
      }
      const reservations = [];
      try {
        for (let i = 0; i < 3; i++) reservations.push(await reservePort());
      } catch (error) {
        await Promise.all(reservations.map(({ release }) => release()));
        throw error;
      }
      [apiPort, gatewayPort] = reservations.map(({ port }) => port);
      const kubePort = reservations[2].port;
      await Promise.all(reservations.map(({ release }) => release()));
      const archive = await downloadChart(pins.chart, directory, request);
      await run("tar", ["-xzf", archive, "-C", directory], {
        step: "chart-extract",
      });
      const chart = join(directory, "intelligence");
      const profile = join(chart, "values-local-evaluation.yaml");
      const overlay = stackConfiguration({
        pins: effectivePins,
        credentials,
        modelPort,
        apiPort,
      });
      const valuesPath = join(directory, "values.yaml");
      await writeFile(valuesPath, yaml.stringify(overlay.values), {
        mode: 0o600,
      });
      const chartArgs = [chart, "-f", profile, "-f", valuesPath];
      const rendered = await run(helm, ["template", "cpki", ...chartArgs], {
        step: "chart-render",
        sensitive: true,
      });
      const hooks = yaml
        .parseAllDocuments(rendered)
        .map((doc) => doc.toJS())
        .filter((doc) =>
          doc?.metadata?.annotations?.["helm.sh/hook"]
            ?.split(",")
            .some((hook) => ["pre-install", "post-install"].includes(hook)),
        )
        .sort(
          (a, b) =>
            Number(a.metadata.annotations["helm.sh/hook-weight"] ?? 0) -
            Number(b.metadata.annotations["helm.sh/hook-weight"] ?? 0),
        );
      for (const prefix of [
        "cpki-migrations-",
        "cpki-bootstrap-",
        "cpki-learning-queue-migration-",
      ]) {
        if (
          hooks.filter(
            (hook) =>
              hook.kind === "Job" && hook.metadata.name.startsWith(prefix),
          ).length !== 1
        )
          throw new Error(
            `Published chart is missing one required ${prefix} hook`,
          );
      }
      const existingClusters = JSON.parse(
        await run(k3d, ["cluster", "list", "--output", "json"], {
          step: "cluster-discovery",
        }),
      );
      if (existingClusters.some((cluster) => cluster.name === id))
        throw new Error(
          "Stack ownership collision; refusing an existing cluster",
        );
      creationAttempted = true;
      await run(
        k3d,
        [
          "cluster",
          "create",
          id,
          "--servers",
          "1",
          "--agents",
          "0",
          "--no-lb",
          "--no-rollback",
          "--kubeconfig-update-default=false",
          "--kubeconfig-switch-context=false",
          "--api-port",
          `127.0.0.1:${kubePort}`,
          "--runtime-label",
          `copilotkit.smoke-stack=${id}@server:*`,
          "--k3s-arg",
          "--disable=traefik@server:0",
          "--image",
          `${pins.images.k3s.repository}@${pins.images.k3s.digest}`,
          "--port",
          `127.0.0.1:${apiPort}:8082@server:0:direct`,
          "--port",
          `127.0.0.1:${gatewayPort}:4401@server:0:direct`,
          "--timeout",
          "180s",
        ],
        { step: "cluster-create", timeoutMs: 240_000 },
      );
      await owned();
      if (candidate) {
        await importCandidateImages({ candidate, node, directory, run });
        candidateImages = await verifyCandidateImports({
          candidate,
          node,
          run,
        });
        await writeFile(
          join(output, "candidate-images.json"),
          JSON.stringify(candidateEvidence(), null, 2),
          { mode: 0o600 },
        );
      }
      const dockerContainerId = (
        await run("docker", ["inspect", "--format", "{{.Id}}", node], {
          step: "node-identity",
        })
      ).trim();
      if (!/^[a-f0-9]{64}$/.test(dockerContainerId))
        throw new Error("Invalid Docker node identity");
      const identity = {
        version: 1,
        runtime: "k3d-docker",
        stackId: id,
        nodeName: node,
        organizationId: credentials.organizationId,
        dockerContainerId,
      };
      await run(
        "docker",
        [
          "exec",
          "-i",
          node,
          "sh",
          "-c",
          "mkdir -p /var/lib/copilotkit/local-evaluation && cat > /var/lib/copilotkit/local-evaluation/identity.json && chmod 644 /var/lib/copilotkit/local-evaluation/identity.json",
        ],
        { step: "node-identity-write", input: JSON.stringify(identity) },
      );
      const kubeconfig = join(directory, "kubeconfig");
      await writeFile(
        kubeconfig,
        await run(k3d, ["kubeconfig", "get", id], {
          step: "kubeconfig",
          sensitive: true,
        }),
        { mode: 0o600 },
      );
      await kube(
        ["apply", "-f", "-"],
        "secrets-apply",
        overlay.secrets.map((item) => yaml.stringify(item)).join("---\n"),
      );
      const stoppedPath = join(directory, "stopped.yaml");
      await writeFile(
        stoppedPath,
        yaml.stringify({
          appApi: { replicaCount: 0 },
          realtimeGateway: { replicaCount: 0 },
          learning: { enabled: false, globalEnabled: false },
        }),
        { mode: 0o600 },
      );
      await run(
        helm,
        [
          "upgrade",
          "--install",
          "cpki",
          ...chartArgs,
          "-f",
          stoppedPath,
          "--kubeconfig",
          kubeconfig,
          "--no-hooks",
          "--timeout",
          "10m",
        ],
        { step: "dependencies-install" },
      );
      for (const name of [
        "cpki-postgresql",
        "cpki-redis-subchart-master",
        "cpki-local-object-storage",
      ])
        await kube(
          ["rollout", "status", `statefulset/${name}`, "--timeout=600s"],
          "dependencies-wait",
        );
      for (const hook of hooks) {
        await kube(["apply", "-f", "-"], "hook-apply", yaml.stringify(hook));
        if (hook.kind !== "Job") continue;
        await kube(
          [
            "wait",
            "--for=condition=complete",
            `job/${hook.metadata.name}`,
            "--timeout=600s",
          ],
          "hook-wait",
        );
        const logs = await kube(
          ["logs", `job/${hook.metadata.name}`],
          "hook-logs",
        );
        if (hook.metadata.name.startsWith("cpki-bootstrap-")) {
          const line = logs
            .split("\n")
            .find((value) => value.startsWith("CPKI_LOCAL_BOOTSTRAP="));
          const project =
            line && JSON.parse(line.slice("CPKI_LOCAL_BOOTSTRAP=".length));
          if (
            !project ||
            project.organizationId !== credentials.organizationId ||
            !/^[1-9][0-9]*$/.test(project.projectId) ||
            project.projectSlug !== "local-app"
          )
            throw new Error(
              "Bootstrap did not return the isolated project identity",
            );
          credentials.projectId = String(project.projectId);
          credentials.apiKey = `cpk-${credentials.projectId}_${credentials.apiKeyShort}_${credentials.apiKeyLong}`;
          secretValues.push(credentials.apiKey);
        }
      }
      await run(
        helm,
        [
          "upgrade",
          "cpki",
          ...chartArgs,
          "--kubeconfig",
          kubeconfig,
          "--no-hooks",
          "--wait",
          "--timeout",
          "10m",
        ],
        { step: "services-start", timeoutMs: 660_000 },
      );
    },
    async collectEvidence() {
      await owned();
      await kube(
        ["get", "pods,jobs,deployments,statefulsets", "-o", "wide"],
        "stack-status",
      );
      await kube(["get", "events", "--sort-by=.lastTimestamp"], "stack-events");
      const pods = JSON.parse(
        await kube(["get", "pods", "-o", "json"], "stack-pods"),
      ).items;
      for (const pod of pods) {
        // Status only above; logs use the runner's shared redaction list.
        await kube(
          ["logs", pod.metadata.name, "--all-containers", "--tail=300"],
          "stack-pod-logs",
        ).catch(() => {});
      }
      const expected = {
        "app-api": effectivePins.images.appApi,
        "realtime-gateway": effectivePins.images.realtimeGateway,
        "learning-agent": effectivePins.images.appApi,
        "learning-reconciler": effectivePins.images.appApi,
        ...(candidate ? { migrations: effectivePins.images.migrations } : {}),
      };
      const evidence = pods.flatMap((pod) =>
        (pod.spec?.containers ?? []).map((container) => {
          const status = pod.status?.containerStatuses?.find(
            ({ name }) => name === container.name,
          );
          return {
            pod: pod.metadata.name,
            component: pod.metadata.labels?.["app.kubernetes.io/component"],
            container: container.name,
            requestedImage: container.image,
            imageID: status?.imageID ?? "",
            ready: status?.ready === true,
            terminatedExitCode: status?.state?.terminated?.exitCode,
          };
        }),
      );
      await writeFile(
        join(output, "stack-images.json"),
        JSON.stringify(evidence, null, 2),
        { mode: 0o600 },
      );
      for (const [component, image] of Object.entries(expected)) {
        const reference = imageReference(image);
        const imported = candidateImages.find(
          (entry) => entry.image === reference,
        );
        if (
          !evidence.some(
            (row) =>
              row.component === component &&
              (component === "migrations"
                ? row.terminatedExitCode === 0
                : row.ready) &&
              row.requestedImage === reference &&
              /sha256:[a-f0-9]{64}$/.test(row.imageID) &&
              (!candidate ||
                imported?.verifiedDigests.includes(
                  row.imageID.match(/sha256:[a-f0-9]{64}$/)[0],
                )),
          )
        )
          throw new Error(
            `Missing pinned running image identity for ${component}`,
          );
      }
      return { workloads: evidence, candidate: candidateEvidence() };
    },
    async stop() {
      if (stopped) return;
      const errors = [];
      // A missing container is an already-clean stack; an inspect failure is
      // distinguished from ownership mismatches before any deletion occurs.
      try {
        if (!clusterRemoved) {
          let deleteCluster = true;
          try {
            await owned();
          } catch (error) {
            if (/ownership/.test(error.message)) throw error;
            const containers = await run(
              "docker",
              [
                "ps",
                "-a",
                "--filter",
                `name=^/${node}$`,
                "--format",
                "{{.Names}}",
              ],
              { step: "cleanup-discovery" },
            );
            if (containers.trim()) throw error;
            deleteCluster = creationAttempted;
          }
          if (deleteCluster)
            await run(k3d, ["cluster", "delete", id], {
              step: "cluster-delete",
              timeoutMs: 180_000,
            });
          clusterRemoved = true;
        }
      } catch (error) {
        errors.push(error);
      }
      try {
        await cleanCandidate();
      } catch (error) {
        errors.push(
          ...(error instanceof AggregateError ? error.errors : [error]),
        );
      }
      if (errors.length) {
        throw new AggregateError(
          errors,
          `Stack cleanup failed: ${errors.map((error) => error.message).join("; ")}`,
          { cause: errors[0] },
        );
      }
      stopped = true;
    },
  };
}
