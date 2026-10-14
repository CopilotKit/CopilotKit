import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const exec = promisify(execFile);
const page = "pageInfo { hasNextPage endCursor } edges { node";
export const operations = {
  proxies:
    "query($environmentId:String!,$serviceId:String!){tcpProxies(environmentId:$environmentId,serviceId:$serviceId){id serviceId environmentId applicationPort proxyPort domain syncStatus}}",
  createProxy:
    "mutation($input:TCPProxyCreateInput!){tcpProxyCreate(input:$input){id serviceId environmentId applicationPort proxyPort domain syncStatus}}",
  deleteProxy: "mutation($id:String!){tcpProxyDelete(id:$id)}",

  environments: `query($projectId:String!,$after:String){project(id:$projectId){environments(first:100,after:$after){${page} {id name projectId createdAt isEphemeral sourceEnvironment{id}}}}}}`,
  services: `query($projectId:String!,$after:String){project(id:$projectId){services(first:100,after:$after){${page} {id name projectId createdAt}}}}}`,
  volumes: `query($projectId:String!,$after:String){project(id:$projectId){volumes(first:100,after:$after){${page} {id name projectId createdAt volumeInstances(first:100){pageInfo{hasNextPage} edges{node{id volumeId serviceId environmentId mountPath state isPendingDeletion}}}}}}}}`,
  environment: `query($id:String!){environment(id:$id){id name projectId createdAt isEphemeral sourceEnvironment{id} serviceInstances(first:100){pageInfo{hasNextPage} edges{node{serviceId serviceName environmentId source{image} latestDeployment{id status instances{id status}} domains{serviceDomains{id domain targetPort}}}}} volumeInstances(first:100){pageInfo{hasNextPage} edges{node{id volumeId serviceId environmentId mountPath state isPendingDeletion}}}}}`,
  createEnvironment:
    "mutation($input:EnvironmentCreateInput!){environmentCreate(input:$input){id name projectId createdAt isEphemeral sourceEnvironment{id}}}",
  createService:
    "mutation($input:ServiceCreateInput!){serviceCreate(input:$input){id name projectId createdAt}}",
  createVolume:
    "mutation($input:VolumeCreateInput!){volumeCreate(input:$input){id projectId name}}",
  configure:
    "mutation($serviceId:String!,$environmentId:String!,$input:ServiceInstanceUpdateInput!){serviceInstanceUpdate(serviceId:$serviceId,environmentId:$environmentId,input:$input)}",
  variables:
    "mutation($input:VariableCollectionUpsertInput!){variableCollectionUpsert(input:$input)}",
  domain:
    "mutation($input:ServiceDomainCreateInput!){serviceDomainCreate(input:$input){id domain serviceId environmentId targetPort}}",
  deploy:
    "mutation($serviceId:String!,$environmentId:String!){serviceInstanceDeployV2(serviceId:$serviceId,environmentId:$environmentId)}",
  restart: "mutation($id:String!){deploymentRestart(id:$id)}",
  deleteService: "mutation($id:String!){serviceDelete(id:$id)}",
  deleteVolume: "mutation($volumeId:String!){volumeDelete(volumeId:$volumeId)}",
  deleteEnvironment: "mutation($id:String!){environmentDelete(id:$id)}",
};
const resultFields = {
  proxies: "tcpProxies",
  createProxy: "tcpProxyCreate",
  deleteProxy: "tcpProxyDelete",
  createEnvironment: "environmentCreate",
  createService: "serviceCreate",
  createVolume: "volumeCreate",
  configure: "serviceInstanceUpdate",
  variables: "variableCollectionUpsert",
  domain: "serviceDomainCreate",
  deploy: "serviceInstanceDeployV2",
  restart: "deploymentRestart",
  deleteService: "serviceDelete",
  deleteVolume: "volumeDelete",
  deleteEnvironment: "environmentDelete",
};

/** CLI owns token selection/refresh. Variables never appear in argv, errors or receipts. */
export function railwayApi({ executable = "railway", env = process.env } = {}) {
  async function request(operation, variables) {
    assert.ok(Object.hasOwn(operations, operation));
    const directory = await mkdtemp(join(tmpdir(), "rich-railway-api-"));
    try {
      await writeFile(join(directory, "query.graphql"), operations[operation], {
        mode: 0o600,
      });
      await writeFile(
        join(directory, "variables.json"),
        JSON.stringify(variables),
        { mode: 0o600 },
      );
      let stdout;
      try {
        ({ stdout } = await exec(
          executable,
          [
            "api",
            "--file",
            join(directory, "query.graphql"),
            "--variables",
            `@${join(directory, "variables.json")}`,
            "--compact",
          ],
          { env, timeout: 20_000, maxBuffer: 8 * 1024 * 1024 },
        ));
      } catch {
        throw new Error(
          `Railway ${operation} failed or timed out; reconcile creation intent before retry`,
        );
      }
      const response = JSON.parse(stdout);
      assert.ok(
        !response.errors?.length,
        `Railway ${operation} returned GraphQL errors`,
      );
      const data = response.data ?? response;
      const value = resultFields[operation]
        ? data[resultFields[operation]]
        : data;
      assert.ok(
        value !== undefined && value !== null && value !== false,
        `Railway ${operation} did not confirm success`,
      );
      return value;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  async function list(kind, projectId) {
    const values = [];
    let after;
    do {
      const connection = (await request(kind, { projectId, after })).project[
        kind
      ];
      assert.ok(
        Array.isArray(connection.edges) &&
          typeof connection.pageInfo?.hasNextPage === "boolean",
        "Incomplete Railway inventory",
      );
      values.push(...connection.edges.map((e) => e.node));
      if (!connection.pageInfo.hasNextPage) break;
      assert.ok(
        connection.pageInfo.endCursor &&
          connection.pageInfo.endCursor !== after,
        "Railway pagination did not advance",
      );
      after = connection.pageInfo.endCursor;
    } while (after);
    return values;
  }
  async function environment(id) {
    const value = (await request("environment", { id })).environment;
    for (const key of ["serviceInstances", "volumeInstances"]) {
      assert.equal(
        value[key].pageInfo.hasNextPage,
        false,
        `Incomplete ${key} inventory; refusing mutation`,
      );
      value[key] = value[key].edges.map((e) => e.node);
    }
    return value;
  }
  return { request, list, environment };
}
