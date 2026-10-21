import { setTimeout as delay } from "node:timers/promises";
import {
  STAGING,
  RUNNER_URL,
  IMAGE,
  equal,
  requireThat,
  validateIdentity,
} from "./contract.mjs";
import { BOUNDED_RECOVERY, validateRecovery } from "./recovery-contract.mjs";
import {
  SECOND_RECOVERY,
  SECOND_BASELINE,
  SECOND_TEMPLATE,
} from "./second-recovery-contract.mjs";

// This remove capability is deliberately limited to the reviewed second incident.
export const REMOVAL_HANDOFF_BASELINE = Object.freeze({
  deploymentId: "41d9b023-1870-444f-8889-c369e26faa54",
  image:
    "ghcr.io/copilotkit/rich-thread-runner@sha256:8db845b5d2b427317524254ff58b3e18db69046b9e75d950b6dc967c004a0019",
});

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
/** Bind operations to one captured scope and an explicit removal baseline. */
export function createRailway({
  token,
  fetch = globalThis.fetch,
  deadline = Date.now() + 210 * 60000,
  clock = Date.now,
  scope: suppliedScope = STAGING,
  imagePattern = IMAGE,
  removalBaseline: suppliedBaseline = REMOVAL_HANDOFF_BASELINE,
}) {
  const scope = Object.freeze({ ...suppliedScope });
  const removalBaseline = Object.freeze({ ...suppliedBaseline });
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
  const validateScope = (state) => {
    for (const key of ["projectId", "environmentId", "serviceId"])
      requireThat(state?.[key] === scope[key], "Railway scope mismatch");
  };
  const deployment = (state, requireMount = true) => {
    validateScope(state);
    const meta = state.meta;
    requireThat(
      meta &&
        imagePattern.test(meta.image) &&
        ((!requireMount && meta.imageDigest == null) ||
          meta.imageDigest === meta.image.split("@")[1]) &&
        (!requireMount || equal(meta.volumeMounts, [scope.mountPath])),
      "Active deployment metadata mismatch",
    );
    return { id: state.id, status: state.status, image: meta.image };
  };
  /** Validate scope and expose only bounded deployment status/image evidence. */
  const handoffDeployment = (state) => {
    validateScope(state);
    requireThat(
      typeof state.id === "string" &&
        state.id.length > 0 &&
        typeof state.status === "string" &&
        /^[A-Z_]{1,40}$/.test(state.status),
      "Incomplete deployment removal evidence",
    );
    const image = state.meta?.image ?? null;
    requireThat(
      image === null || imagePattern.test(image),
      "Invalid deployment image evidence",
    );
    return {
      id: state.id,
      status: state.status,
      image,
      deploymentStopped: state.deploymentStopped,
    };
  };
  /** Read the exact deployment without interpreting the unreliable stopped flag. */
  const readDeploymentStatus = async (id) => {
    requireThat(
      typeof id === "string" && id.length > 0,
      "Deployment identity required",
    );
    const { deployment: state } = await query(
      "query($id:String!){deployment(id:$id){id status projectId environmentId serviceId deploymentStopped meta}}",
      { id },
    );
    const result = handoffDeployment(state);
    requireThat(result.id === id, "Railway deployment identity mismatch");
    return result;
  };
  let removeAttempted = false;
  return {
    readDeploymentStatus,
    /** Issue at most one removal request for the reviewed active baseline. */
    async removeDeployment(id) {
      requireThat(
        id === removalBaseline.deploymentId,
        "Unauthorized deployment removal",
      );
      requireThat(!removeAttempted, "Deployment removal already attempted");
      const state = await readDeploymentStatus(id);
      requireThat(
        state.image === removalBaseline.image && state.status === "SUCCESS",
        "Removal baseline image mismatch",
      );
      // A lost or negative response is ambiguous: never repeat this mutation.
      requireThat(!removeAttempted, "Deployment removal already attempted");
      removeAttempted = true;
      const result = await query(
        "mutation($id:String!){deploymentRemove(id:$id)}",
        { id },
      );
      if (result.deploymentRemove !== true) {
        const error = new Error("Deployment removal unconfirmed");
        error.removalOutcome =
          result.deploymentRemove === false ? "refused" : "unknown";
        error.removalResponse =
          result.deploymentRemove === false ? false : null;
        throw error;
      }
      // Acknowledgement is not finality; callers must independently read status REMOVED.
      return { removeAcknowledged: true };
    },
    /** Enumerate every deployment in the captured scope, failing on incomplete pages. */
    async handoffInventory() {
      const rows = [];
      const ids = new Set();
      const cursors = new Set();
      let after = null;
      for (let page = 0; page < 20; page++) {
        const { deployments: connection } = await query(
          "query($input:DeploymentListInput!,$first:Int!,$after:String){deployments(input:$input,first:$first,after:$after){pageInfo{hasNextPage endCursor} edges{node{id status projectId environmentId serviceId deploymentStopped meta}}}}",
          {
            input: {
              projectId: scope.projectId,
              environmentId: scope.environmentId,
              serviceId: scope.serviceId,
            },
            first: 100,
            after,
          },
        );
        requireThat(
          Array.isArray(connection?.edges) &&
            connection.edges.length <= 100 &&
            typeof connection.pageInfo?.hasNextPage === "boolean",
          "Incomplete deployment inventory",
        );
        for (const edge of connection.edges) {
          const row = handoffDeployment(edge.node);
          requireThat(
            !ids.has(row.id),
            "Duplicate deployment inventory identity",
          );
          ids.add(row.id);
          rows.push(row);
        }
        if (!connection.pageInfo.hasNextPage) return rows;
        const cursor = connection.pageInfo.endCursor;
        requireThat(
          typeof cursor === "string" &&
            cursor.length > 0 &&
            !cursors.has(cursor),
          "Incomplete deployment inventory cursor",
        );
        cursors.add(cursor);
        after = cursor;
      }
      throw new Error("Deployment inventory pagination bound exceeded");
    },
    async inspect({ allowNoActive = false, allowMissingLatest = false } = {}) {
      const { serviceInstance: service } = await query(
        "query($e:String!,$s:String!){serviceInstance(environmentId:$e,serviceId:$s){id serviceId environmentId source{image} activeDeployments{id status projectId environmentId serviceId meta} latestDeployment{id status projectId environmentId serviceId meta}}}",
        { e: scope.environmentId, s: scope.serviceId },
      );
      requireThat(
        service?.id === scope.instanceId &&
          service.serviceId === scope.serviceId &&
          service.environmentId === scope.environmentId,
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
      const missingLatest = service.latestDeployment === null;
      requireThat(
        !missingLatest ||
          (allowNoActive === true &&
            allowMissingLatest === true &&
            active === null),
        "Missing latest deployment",
      );
      const latest = missingLatest
        ? null
        : deployment(
            service.latestDeployment,
            service.latestDeployment?.status === "SUCCESS",
          );
      const { environment } = await query(
        "query($e:String!){environment(id:$e){id projectId volumeInstances(first:100){pageInfo{hasNextPage endCursor} edges{node{id volumeId environmentId serviceId mountPath isPendingDeletion}}}}}",
        { e: scope.environmentId },
      );
      requireThat(
        environment?.id === scope.environmentId &&
          environment.projectId === scope.projectId &&
          environment.volumeInstances?.pageInfo?.hasNextPage === false,
        "Railway environment proof incomplete",
      );
      const volumes = environment.volumeInstances.edges
        .map((edge) => edge.node)
        .filter((volume) => volume.serviceId === scope.serviceId);
      requireThat(volumes.length === 1, "Ambiguous service volume");
      const volume = volumes[0];
      requireThat(
        volume.id === scope.volumeInstanceId &&
          volume.volumeId === scope.volumeId &&
          volume.environmentId === scope.environmentId &&
          volume.mountPath === scope.mountPath &&
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
      requireThat(
        equal(scope, STAGING),
        "Recovery authorization requires staging scope",
      );
      const {
        operationId,
        baselineIdentity,
        targetIdentity,
        templateSha256,
        ...fixed
      } = value;
      if (fixed.version === 2) {
        requireThat(
          equal(fixed, SECOND_RECOVERY) &&
            equal(baselineIdentity, SECOND_BASELINE.runtimeIdentity) &&
            templateSha256 === SECOND_TEMPLATE,
          "Unknown second recovery case",
        );
        validateIdentity(targetIdentity);
        requireThat(
          targetIdentity.sourceRevision !== baselineIdentity.sourceRevision,
          "New second recovery runtime required",
        );
      } else {
        validateRecovery(fixed, baselineIdentity, targetIdentity);
        requireThat(equal(fixed, BOUNDED_RECOVERY), "Unknown recovery case");
      }
      requireThat(
        /^github-655515393-\d+$/.test(operationId) &&
          /^[a-f0-9]{64}$/.test(templateSha256),
        "Invalid recovery binding",
      );
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
      requireThat(imagePattern.test(image), "Immutable runner image required");
      const data = await query(
        "mutation($serviceId:String!,$environmentId:String!,$input:ServiceInstanceUpdateInput!){serviceInstanceUpdate(serviceId:$serviceId,environmentId:$environmentId,input:$input)}",
        {
          serviceId: scope.serviceId,
          environmentId: scope.environmentId,
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
        { serviceId: scope.serviceId, environmentId: scope.environmentId },
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
      validateScope(state);
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
