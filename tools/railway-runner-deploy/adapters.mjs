import { setTimeout as delay } from "node:timers/promises";
import { STAGING, RUNNER_URL, IMAGE, equal, requireThat } from "./contract.mjs";
import { BOUNDED_RECOVERY, validateRecovery } from "./recovery-contract.mjs";

/** Consume a bounded remote body without including it in an error. */
export async function boundedBytes(response, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    requireThat(size <= limit, "Remote response exceeds bound");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
/** Bind HTTP timeouts to an absolute workflow deadline. */
function timeout(deadline, clock) {
  const remaining = deadline - clock();
  requireThat(remaining > 0, "Deployment deadline exceeded");
  return AbortSignal.timeout(Math.min(30000, remaining));
}
/** Expose only fixed staging queries and the two authorized image mutations. */
export function createRailway({
  token,
  fetch = globalThis.fetch,
  deadline = Date.now() + 210 * 60000,
  clock = Date.now,
}) {
  requireThat(
    typeof token === "string" && token.length > 0,
    "Railway credential required",
  );
  const query = async (document, variables) => {
    try {
      const response = await fetch("https://backboard.railway.app/graphql/v2", {
        method: "POST",
        redirect: "error",
        signal: timeout(deadline, clock),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ query: document, variables }),
      });
      requireThat(response.ok, "Railway request refused");
      const value = JSON.parse(await boundedBytes(response));
      requireThat(value.data && !value.errors, "Railway request refused");
      return value.data;
    } catch {
      throw new Error(
        "Railway request failed; deployment state requires verification",
      );
    }
  };
  const scope = (state) => {
    for (const key of ["projectId", "environmentId", "serviceId"])
      requireThat(state?.[key] === STAGING[key], "Railway scope mismatch");
  };
  const deployment = (state, requireMount = true) => {
    scope(state);
    const meta = state.meta;
    requireThat(
      meta &&
        IMAGE.test(meta.image) &&
        ((!requireMount && meta.imageDigest == null) ||
          meta.imageDigest === meta.image.split("@")[1]) &&
        (!requireMount || equal(meta.volumeMounts, ["/data"])),
      "Active deployment metadata mismatch",
    );
    return { id: state.id, status: state.status, image: meta.image };
  };
  return {
    async inspect({ allowNoActive = false } = {}) {
      const { serviceInstance: service } = await query(
        "query($e:String!,$s:String!){serviceInstance(environmentId:$e,serviceId:$s){id serviceId environmentId source{image} activeDeployments{id status projectId environmentId serviceId meta} latestDeployment{id status projectId environmentId serviceId meta}}}",
        { e: STAGING.environmentId, s: STAGING.serviceId },
      );
      requireThat(
        service?.id === STAGING.instanceId &&
          service.serviceId === STAGING.serviceId &&
          service.environmentId === STAGING.environmentId,
        "Railway instance mismatch",
      );
      requireThat(
        Array.isArray(service.activeDeployments) &&
          (service.activeDeployments.length === 1 ||
            (allowNoActive && service.activeDeployments.length === 0)),
        "Ambiguous active deployment",
      );
      const active = service.activeDeployments.length
        ? deployment(service.activeDeployments[0])
        : null;
      const latest = deployment(
        service.latestDeployment,
        service.latestDeployment.status === "SUCCESS",
      );
      const { environment } = await query(
        "query($e:String!){environment(id:$e){id projectId volumeInstances(first:100){pageInfo{hasNextPage endCursor} edges{node{id volumeId environmentId serviceId mountPath isPendingDeletion}}}}}",
        { e: STAGING.environmentId },
      );
      requireThat(
        environment?.id === STAGING.environmentId &&
          environment.projectId === STAGING.projectId &&
          environment.volumeInstances?.pageInfo?.hasNextPage === false,
        "Railway environment proof incomplete",
      );
      const volumes = environment.volumeInstances.edges
        .map((edge) => edge.node)
        .filter((volume) => volume.serviceId === STAGING.serviceId);
      requireThat(volumes.length === 1, "Ambiguous service volume");
      const volume = volumes[0];
      requireThat(
        volume.id === STAGING.volumeInstanceId &&
          volume.volumeId === STAGING.volumeId &&
          volume.environmentId === STAGING.environmentId &&
          volume.mountPath === "/data" &&
          volume.isPendingDeletion === false,
        "Retained volume mismatch",
      );
      return {
        configuredImage: service.source?.image,
        active,
        latest,
        volumeId: volume.volumeId,
        volumeInstanceId: volume.id,
        mountPath: volume.mountPath,
      };
    },
    async setRecoveryAuthorization(value) {
      const {
        operationId,
        baselineIdentity,
        targetIdentity,
        templateSha256,
        ...fixed
      } = value;
      validateRecovery(fixed, baselineIdentity, targetIdentity);
      requireThat(
        /^github-655515393-\d+$/.test(operationId) &&
          /^[a-f0-9]{64}$/.test(templateSha256),
        "Invalid recovery binding",
      );
      requireThat(equal(fixed, BOUNDED_RECOVERY), "Unknown recovery case");
      const data = await query(
        "mutation($input:VariableUpsertInput!){variableUpsert(input:$input)}",
        {
          input: {
            projectId: STAGING.projectId,
            environmentId: STAGING.environmentId,
            serviceId: STAGING.serviceId,
            name: "RICH_RECOVERY_AUTHORIZATION_JSON",
            value: JSON.stringify(value),
            skipDeploys: true,
          },
        },
      );
      requireThat(
        data.variableUpsert === true,
        "Recovery authorization update unconfirmed",
      );
    },
    async setImage(image) {
      requireThat(IMAGE.test(image), "Immutable runner image required");
      const data = await query(
        "mutation($serviceId:String!,$environmentId:String!,$input:ServiceInstanceUpdateInput!){serviceInstanceUpdate(serviceId:$serviceId,environmentId:$environmentId,input:$input)}",
        {
          serviceId: STAGING.serviceId,
          environmentId: STAGING.environmentId,
          input: { source: { image } },
        },
      );
      requireThat(
        data.serviceInstanceUpdate === true,
        "Railway image update unconfirmed",
      );
    },
    async deploy() {
      const data = await query(
        "mutation($serviceId:String!,$environmentId:String!){serviceInstanceDeployV2(serviceId:$serviceId,environmentId:$environmentId)}",
        { serviceId: STAGING.serviceId, environmentId: STAGING.environmentId },
      );
      requireThat(
        typeof data.serviceInstanceDeployV2 === "string" &&
          data.serviceInstanceDeployV2.length > 0,
        "Railway deploy unconfirmed",
      );
      return data.serviceInstanceDeployV2;
    },
    async deployment(id) {
      const { deployment: state } = await query(
        "query($id:String!){deployment(id:$id){id status projectId environmentId serviceId meta}}",
        { id },
      );
      scope(state);
      requireThat(state.id === id, "Railway deployment identity mismatch");
      if (state.status === "SUCCESS") deployment(state);
      return { id: state.id, status: state.status };
    },
  };
}
const retryStatus = new Set([408, 429, 500, 502, 503, 504]);
const retryCode = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);
/** Retry read-only runner snapshots through restart; owner-changing POSTs remain single attempts. */
export function createRunner({
  token,
  fetch = globalThis.fetch,
  deadline = Date.now() + 210 * 60000,
  clock = Date.now,
  sleep = delay,
}) {
  requireThat(
    typeof token === "string" && token.length > 0,
    "Runner credential required",
  );
  const request = async (path, body, probe = false) => {
    let wait = 1000;
    for (;;) {
      let retry = false;
      try {
        const response = await fetch(`${RUNNER_URL}${path}`, {
          method: body ? "POST" : "GET",
          redirect: "error",
          signal: timeout(deadline, clock),
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (!body && retryStatus.has(response.status)) {
          await response.body?.cancel();
          retry = true;
        } else {
          requireThat(response.ok, "Runner deployment request refused");
          return JSON.parse(await boundedBytes(response, 65536));
        }
      } catch (error) {
        if (
          !body &&
          (error?.name === "TimeoutError" ||
            retryCode.has(error?.code) ||
            retryCode.has(error?.cause?.code))
        )
          retry = true;
        else {
          // Remote errors may contain credentials or private template data.
          // eslint-disable-next-line preserve-caught-error
          throw new Error("Runner deployment request failed; drain retained");
        }
      }
      if (probe && retry) return null;
      requireThat(
        retry && clock() < deadline,
        "Runner deployment deadline exceeded",
      );
      await sleep(Math.min(wait, deadline - clock()));
      wait = Math.min(wait * 2, 10000);
    }
  };
  return {
    get: () => request("/deployment"),
    probe: () => request("/deployment", undefined, true),
    drain: (body) => request("/deployment/drain", body),
    recover: (body) => request("/deployment/recover", body),
    resume: (body) => request("/deployment/resume", body),
  };
}
