import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { durableJson } from "./journal.mjs";
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
export class RailwayRequestError extends Error {
  constructor(diagnostic) {
    super(
      `Railway ${diagnostic.operation} failed: ${diagnostic.failureClass}; outcome ${diagnostic.outcome}`,
    );
    this.name = "RailwayRequestError";
    this.diagnostic = Object.freeze(diagnostic);
  }
}
const knownCodes = new Set([
  "GRAPHQL_PARSE_FAILED",
  "GRAPHQL_VALIDATION_FAILED",
  "BAD_USER_INPUT",
  "INTERNAL_SERVER_ERROR",
  "UNAUTHENTICATED",
  "FORBIDDEN",
]);
const knownMessages = new Set(["Error in name - Invalid input"]);
export function railwayApi({
  executable = "railway",
  env = process.env,
  diagnosticDirectory,
} = {}) {
  async function fail(
    operation,
    failureClass,
    outcome = "unknown",
    codes = [],
    processFailure = {},
  ) {
    const diagnostic = {
      version: 1,
      id: randomUUID(),
      operation,
      failureClass,
      outcome,
      codes,
      ...processFailure,
      at: new Date().toISOString(),
    };
    if (diagnosticDirectory) {
      await mkdir(diagnosticDirectory, { recursive: true, mode: 0o700 });
      await durableJson(
        join(diagnosticDirectory, `${diagnostic.id}.json`),
        diagnostic,
      );
    }
    throw new RailwayRequestError(diagnostic);
  }
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
            "--allow-errors",
          ],
          { env, timeout: 20_000, maxBuffer: 8 * 1024 * 1024 },
        ));
      } catch (error) {
        // Only OS spawn failures prove the CLI never executed. Timeout, signal,
        // nonzero exit and output overflow can all follow a committed mutation.
        const processFailure = {
          ...(Number.isInteger(error.code) &&
          error.code >= 0 &&
          error.code <= 255
            ? { exitCode: error.code }
            : {}),
          ...(["SIGTERM", "SIGKILL", "SIGABRT", "SIGSEGV", "SIGINT"].includes(
            error.signal,
          )
            ? { signal: error.signal }
            : {}),
          ...([
            "ENOENT",
            "EACCES",
            "ENOEXEC",
            "ETIMEDOUT",
            "ENOBUFS",
            "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
          ].includes(error.code)
            ? { osCode: error.code }
            : {}),
        };
        if (["ENOENT", "EACCES", "ENOEXEC"].includes(error.code))
          return await fail(
            operation,
            "cli-not-started",
            "not-executed",
            [],
            processFailure,
          );
        return await fail(
          operation,
          error.killed ? "cli-interrupted" : "cli-failed",
          "unknown",
          [],
          processFailure,
        );
      }
      let response;
      try {
        response = JSON.parse(stdout);
      } catch {
        return await fail(operation, "invalid-response");
      }
      if (!response || typeof response !== "object")
        return await fail(operation, "invalid-response");
      if (response.errors !== undefined && !Array.isArray(response.errors))
        return await fail(operation, "invalid-response");
      if (response.errors?.length) {
        const errors = response.errors;
        const codes = [
          ...new Set(
            errors
              .slice(0, 16)
              .map((e) => e?.extensions?.code)
              .filter((code) => knownCodes.has(code)),
          ),
        ];
        // GraphQL parsing/validation occurs before execution. Generic resolver
        // errors, BAD_USER_INPUT, authorization errors and partial data do not
        // establish that no side effect occurred.
        const preExecution =
          Array.isArray(errors) &&
          errors.length <= 16 &&
          !Object.hasOwn(response, "data") &&
          errors.every((e) =>
            ["GRAPHQL_PARSE_FAILED", "GRAPHQL_VALIDATION_FAILED"].includes(
              e?.extensions?.code,
            ),
          );
        // Railway documents decimal trace IDs; retain only bounded canonical
        // uint64 strings, never arbitrary messages or extension values. Current
        // API responses use error.traceId; docs also show extensions.traceId.
        const traceIds = [
          ...new Set(
            errors
              .slice(0, 16)
              .flatMap((error) => [error?.traceId, error?.extensions?.traceId])
              .filter(
                (value) =>
                  typeof value === "string" &&
                  /^[1-9][0-9]{0,19}$/.test(value) &&
                  BigInt(value).toString() === value &&
                  BigInt(value) <= 18446744073709551615n,
              ),
          ),
        ].slice(0, 16);
        const messages = [
          ...new Set(
            errors
              .slice(0, 16)
              .map((error) => error?.message)
              .filter((message) => knownMessages.has(message)),
          ),
        ];
        return await fail(
          operation,
          "graphql-rejected",
          preExecution ? "not-executed" : "unknown",
          codes,
          {
            ...(traceIds.length ? { traceIds } : {}),
            ...(messages.length ? { messages } : {}),
          },
        );
      }
      const data = response.data ?? response;
      const value = resultFields[operation]
        ? data[resultFields[operation]]
        : data;
      if (value === undefined || value === null || value === false)
        return await fail(operation, "unconfirmed-response");
      return value;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  async function list(kind, projectId) {
    const values = [];
    let after;
    const cursors = new Set();
    const ids = new Set();
    let pages = 0;
    const deadline = Date.now() + 40_000;
    do {
      assert.ok(++pages <= 100, "Railway inventory page limit exceeded");
      assert.ok(Date.now() < deadline, "Railway inventory deadline exceeded");
      const connection = (await request(kind, { projectId, after })).project[
        kind
      ];
      assert.ok(
        Array.isArray(connection.edges) &&
          typeof connection.pageInfo?.hasNextPage === "boolean",
        "Incomplete Railway inventory",
      );
      for (const edge of connection.edges) {
        const value = edge?.node;
        assert.ok(
          value &&
            typeof value.id === "string" &&
            value.id.length &&
            value.projectId === projectId &&
            !ids.has(value.id),
          "Malformed or duplicate Railway inventory entry",
        );
        ids.add(value.id);
        values.push(value);
      }
      if (!connection.pageInfo.hasNextPage) break;
      assert.ok(
        typeof connection.pageInfo.endCursor === "string" &&
          connection.pageInfo.endCursor.length &&
          !cursors.has(connection.pageInfo.endCursor),
        "Railway pagination did not advance",
      );
      after = connection.pageInfo.endCursor;
      cursors.add(after);
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
