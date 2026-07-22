import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const corpusPath = fileURLToPath(
  new URL("../conformance/registry-adapters-v1.json", import.meta.url),
);
const sdkCorpusPath = fileURLToPath(
  new URL("../conformance/registry-sdk-v1.json", import.meta.url),
);
const packageJsonPath = fileURLToPath(
  new URL("../package.json", import.meta.url),
);

const requiredCaseNames = [
  "cold-fresh-load",
  "explicit-cached-preload",
  "throttle-hit",
  "concurrent-singleflight",
  "etag-unchanged",
  "changed-revision",
  "empty",
  "revoked",
  "transient-stale",
  "integrity-stale",
  "denial",
  "too-many-skills",
  "skill-md-too-large",
  "aggregate-too-large",
  "invalid-utf8",
  "script-disabled",
  "close-idempotent",
  "readiness-ready",
  "readiness-timeout",
  "readiness-denied-rejects",
  "readiness-stale-rejects",
  "readiness-closed-rejects",
  "retry-after-failed-throttle-window",
  "load-after-close-rejects",
  "telemetry-sink-failure-singleflight",
  "error-category-auth-denied",
  "error-category-permission-denied",
  "http-401-denied",
  "http-403-denied",
  "http-404-denied",
  "http-410-denied",
  "container-archived-denied",
  "project-mismatch-denied",
  "container-not-found-denied",
  "registry-unrecoverable-denied",
] as const;

const permanentDenialSources = [
  "error-category-auth",
  "error-category-permission",
  "http-401",
  "http-403",
  "http-404",
  "http-410",
  "container-archived",
  "project-mismatch",
  "container-not-found",
  "registry-unrecoverable",
] as const;

const lifecycleStates = new Set([
  "cold",
  "loading",
  "ready",
  "refreshing",
  "stale",
  "denied",
  "revoked",
  "closed",
]);

const allowedTransitions = new Set([
  "cold>loading",
  "cold>closed",
  "loading>ready",
  "loading>stale",
  "loading>denied",
  "loading>revoked",
  "loading>closed",
  "ready>refreshing",
  "ready>closed",
  "refreshing>ready",
  "refreshing>stale",
  "refreshing>denied",
  "refreshing>revoked",
  "refreshing>closed",
  "stale>refreshing",
  "stale>denied",
  "stale>revoked",
  "stale>closed",
  "denied>closed",
  "revoked>closed",
]);

const canonicalTelemetryNames = new Set([
  "load.started",
  "load.throttled",
  "load.singleflight_joined",
  "load.succeeded",
  "load.failed",
  "status.changed",
]);

const telemetryMetadataFields = new Set([
  "outcome",
  "freshness",
  "status",
  "reason",
  "retryable",
  "source",
  "joinedCallers",
  "durationMs",
]);

const adapterValidationCodes = new Map([
  ["too-many-skills", "INTELLIGENCE_ADAPTER_TOO_MANY_SKILLS"],
  ["skill-md-too-large", "INTELLIGENCE_ADAPTER_SKILL_TOO_LARGE"],
  ["aggregate-too-large", "INTELLIGENCE_ADAPTER_CONTEXT_TOO_LARGE"],
  ["invalid-utf8", "INTELLIGENCE_ADAPTER_INVALID_UTF8"],
  ["script-disabled", "INTELLIGENCE_ADAPTER_SCRIPT_DISABLED"],
]);

type JsonObject = Record<string, unknown>;

function readJson(path: string): JsonObject {
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

function object(value: unknown, label: string, failures: string[]): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    failures.push(`${label} must be an object`);
    return {};
  }
  return value as JsonObject;
}

function array(value: unknown, label: string, failures: string[]): unknown[] {
  if (!Array.isArray(value)) {
    failures.push(`${label} must be an array`);
    return [];
  }
  return value;
}

function integer(value: unknown, label: string, failures: string[]): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    failures.push(`${label} must be a non-negative integer`);
    return -1;
  }
  return Number(value);
}

function validateError(
  value: unknown,
  label: string,
  failures: string[],
): JsonObject {
  const error = object(value, label, failures);
  for (const field of ["code", "category", "causeIdentity"] as const) {
    if (typeof error[field] !== "string" || error[field].length === 0) {
      failures.push(`${label}.${field} must be a non-empty string`);
    }
  }
  if (typeof error.retryable !== "boolean") {
    failures.push(`${label}.retryable must be boolean`);
  }
  if (
    error.httpStatus !== undefined &&
    (!Number.isInteger(error.httpStatus) ||
      Number(error.httpStatus) < 100 ||
      Number(error.httpStatus) > 599)
  ) {
    failures.push(`${label}.httpStatus must be an HTTP status`);
  }
  return error;
}

function validateOutcome(
  value: unknown,
  label: string,
  failures: string[],
): JsonObject {
  const outcome = object(value, label, failures);
  const hasResult = Object.hasOwn(outcome, "result");
  const hasError = Object.hasOwn(outcome, "error");
  if (hasResult === hasError) {
    failures.push(`${label} must contain exactly one of result or error`);
  }
  if (hasResult) {
    const result = object(outcome.result, `${label}.result`, failures);
    if (
      result.state !== undefined &&
      (typeof result.state !== "string" || !lifecycleStates.has(result.state))
    ) {
      failures.push(
        `${label}.result.state must be a canonical lifecycle state`,
      );
    }
  }
  if (hasError) validateError(outcome.error, `${label}.error`, failures);
  return outcome;
}

function validateOperations(
  value: unknown,
  label: string,
  failures: string[],
): JsonObject[] {
  const operations = array(value, label, failures).map((entry, index) =>
    object(entry, `${label}[${index}]`, failures),
  );
  if (operations.length === 0) failures.push(`${label} cannot be empty`);
  const timestamps = operations.map((operation, index) =>
    integer(operation.atMs, `${label}[${index}].atMs`, failures),
  );
  if (new Set(timestamps).size !== timestamps.length) {
    failures.push(`${label} has duplicate timestamps`);
  }
  for (let index = 1; index < timestamps.length; index += 1) {
    if (timestamps[index] <= timestamps[index - 1]) {
      failures.push(`${label} must be ordered by increasing atMs`);
    }
  }
  for (const [index, operation] of operations.entries()) {
    if (typeof operation.kind !== "string" || operation.kind.length === 0) {
      failures.push(`${label}[${index}].kind must be a non-empty string`);
    }
  }
  return operations;
}

function expectedTerminalStatus(genericSdk: JsonObject): string | undefined {
  if (Object.hasOwn(genericSdk, "result")) {
    const result = genericSdk.result as JsonObject;
    return typeof result.state === "string" && lifecycleStates.has(result.state)
      ? result.state
      : undefined;
  }
  const error = genericSdk.error as JsonObject | undefined;
  switch (error?.code) {
    case "LEARNING_REGISTRY_CLOSED":
      return "closed";
    case "LEARNING_REGISTRY_STALE":
      return "stale";
    case "LEARNING_REGISTRY_READINESS_TIMEOUT":
      return "loading";
    default:
      return "denied";
  }
}

function validateTransitions(
  value: unknown,
  genericSdk: JsonObject,
  operations: JsonObject[],
  label: string,
  failures: string[],
): void {
  const transitions = array(value, label, failures).map((entry, index) =>
    object(entry, `${label}[${index}]`, failures),
  );
  const stateChanging = operations.some((operation) =>
    [
      "load",
      "load-caller-a",
      "cached-preload",
      "close",
      "registry-request",
    ].includes(String(operation.kind)),
  );
  if (stateChanging && transitions.length === 0) {
    failures.push(`${label} is missing status transitions`);
  }
  let previousAtMs = -1;
  let previousTo: unknown;
  for (const [index, transition] of transitions.entries()) {
    const atMs = integer(transition.atMs, `${label}[${index}].atMs`, failures);
    if (atMs <= previousAtMs) {
      failures.push(`${label} must be ordered without duplicate timestamps`);
    }
    const from = transition.from;
    const to = transition.to;
    if (
      typeof from !== "string" ||
      typeof to !== "string" ||
      !lifecycleStates.has(from) ||
      !lifecycleStates.has(to)
    ) {
      failures.push(`${label}[${index}] uses a non-canonical lifecycle state`);
    } else if (!allowedTransitions.has(`${from}>${to}`)) {
      failures.push(
        `${label}[${index}] is an impossible ${from}>${to} transition`,
      );
    }
    if (index > 0 && from !== previousTo) {
      failures.push(
        `${label}[${index}] does not continue the prior transition`,
      );
    }
    previousAtMs = atMs;
    previousTo = to;
  }
  const terminalStatus = expectedTerminalStatus(genericSdk);
  if (transitions.length > 0 && previousTo !== terminalStatus) {
    failures.push(`${label} does not reach the generic SDK terminal status`);
  }
}

function validateCalls(
  value: unknown,
  operations: JsonObject[],
  label: string,
  failures: string[],
): void {
  const calls = object(value, label, failures);
  const client = object(calls.client, `${label}.client`, failures);
  const routing = object(calls.routing, `${label}.routing`, failures);
  const projection = integer(
    client.projection,
    `${label}.client.projection`,
    failures,
  );
  const bundle = integer(client.bundle, `${label}.client.bundle`, failures);
  const cached = integer(client.cached, `${label}.client.cached`, failures);
  const network = integer(client.network, `${label}.client.network`, failures);
  const readiness = integer(
    routing.readiness,
    `${label}.routing.readiness`,
    failures,
  );
  const nativeHook = integer(
    routing.nativeHook,
    `${label}.routing.nativeHook`,
    failures,
  );

  const projectionOperations = operations.filter((operation) =>
    [
      "projection-request",
      "conditional-projection-request",
      "registry-request",
    ].includes(String(operation.kind)),
  ).length;
  const bundleOperations = operations.filter(
    (operation) => operation.kind === "bundle-request",
  ).length;
  const cachedOperations = operations.filter((operation) =>
    ["cache-read", "cache-fallback", "cached-preload"].includes(
      String(operation.kind),
    ),
  ).length;
  if (projection !== projectionOperations) {
    failures.push(`${label} projection call count disagrees with operations`);
  }
  if (bundle !== bundleOperations) {
    failures.push(`${label} bundle call count disagrees with operations`);
  }
  if (cached !== cachedOperations) {
    failures.push(`${label} cached call count disagrees with operations`);
  }
  if (network !== projection + bundle) {
    failures.push(
      `${label} network call count must equal projection plus bundle`,
    );
  }
  if (readiness !== 1 || nativeHook !== 1) {
    failures.push(
      `${label} routing counts must cover readiness and native hook once`,
    );
  }
}

function validateRenderedRecords(
  value: unknown,
  genericSdk: JsonObject,
  sdkCorpus: JsonObject,
  label: string,
  failures: string[],
): void {
  const records = array(value, label, failures).map((entry, index) =>
    object(entry, `${label}[${index}]`, failures),
  );
  const identity = object(sdkCorpus.identity, "sdk.identity", failures);
  const projection = object(sdkCorpus.projection, "sdk.projection", failures);
  const entries = array(projection.entries, "sdk.projection.entries", failures);
  const projectionEntry = object(
    entries[0],
    "sdk.projection.entries[0]",
    failures,
  );
  const bundle = object(sdkCorpus.bundle, "sdk.bundle", failures);
  let aggregateBytes = 0;
  for (const [index, record] of records.entries()) {
    if (
      record.skillId !== identity.skillId ||
      record.versionId !== identity.versionId ||
      record.position !== projectionEntry.position ||
      record.name !== projectionEntry.name ||
      record.description !== projectionEntry.description ||
      record.text !== bundle.fileContents
    ) {
      failures.push(
        `${label}[${index}] rendered identity/order/text drifted from SDK fixture`,
      );
    }
    const renderedBytes =
      typeof record.text === "string"
        ? Buffer.byteLength(record.text, "utf8")
        : -1;
    if (record.byteLength !== renderedBytes) {
      failures.push(`${label}[${index}] rendered byte count is not exact`);
    }
    aggregateBytes += Math.max(renderedBytes, 0);
  }
  if (Object.hasOwn(genericSdk, "result")) {
    const result = object(genericSdk.result, `${label}.result`, failures);
    if (
      result.skillCount !== undefined &&
      result.skillCount !== records.length
    ) {
      failures.push(`${label} count differs from generic SDK skillCount`);
    }
    if (
      result.aggregateByteLength !== undefined &&
      result.aggregateByteLength !== aggregateBytes
    ) {
      failures.push(
        `${label} bytes differ from generic SDK aggregateByteLength`,
      );
    }
  } else if (records.length !== 0) {
    failures.push(`${label} must be empty when the generic SDK rejects`);
  }
}

function validateTelemetry(
  expected: JsonObject,
  sdkCorpus: JsonObject,
  label: string,
  failures: string[],
): void {
  const names = array(
    expected.telemetryNames,
    `${label}.telemetryNames`,
    failures,
  );
  const records = array(
    expected.telemetryRecords,
    `${label}.telemetryRecords`,
    failures,
  ).map((entry, index) =>
    object(entry, `${label}.telemetryRecords[${index}]`, failures),
  );
  if (
    JSON.stringify(names) !==
    JSON.stringify(records.map((record) => record.name))
  ) {
    failures.push(`${label} telemetry names and ordered records differ`);
  }
  for (const [index, name] of names.entries()) {
    if (typeof name !== "string" || !canonicalTelemetryNames.has(name)) {
      failures.push(
        `${label}.telemetryNames[${index}] uses non-canonical telemetry`,
      );
    }
  }
  let priorAtMs = -1;
  const sensitiveValues = [
    ...Object.values(object(sdkCorpus.identity, "sdk.identity", failures)),
    object(sdkCorpus.http, "sdk.http", failures).authorization,
    object(sdkCorpus.bundle, "sdk.bundle", failures).filePath,
    object(sdkCorpus.bundle, "sdk.bundle", failures).fileContents,
  ].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  for (const [index, record] of records.entries()) {
    if (
      typeof record.name !== "string" ||
      !canonicalTelemetryNames.has(record.name)
    ) {
      failures.push(
        `${label}.telemetryRecords[${index}] uses non-canonical telemetry`,
      );
    }
    const atMs = integer(
      record.atMs,
      `${label}.telemetryRecords[${index}].atMs`,
      failures,
    );
    if (atMs <= priorAtMs) {
      failures.push(`${label} telemetry records must be exactly ordered`);
    }
    priorAtMs = atMs;
    const metadata = object(
      record.metadata,
      `${label}.telemetryRecords[${index}].metadata`,
      failures,
    );
    for (const key of Object.keys(metadata)) {
      if (!telemetryMetadataFields.has(key)) {
        failures.push(
          `${label} telemetry metadata field ${key} is not allowed`,
        );
      }
    }
    const metadataValueValid =
      (metadata.outcome === undefined ||
        ["success", "failure"].includes(String(metadata.outcome))) &&
      (metadata.freshness === undefined ||
        ["fresh", "cached", "stale"].includes(String(metadata.freshness))) &&
      (metadata.status === undefined ||
        (typeof metadata.status === "string" &&
          lifecycleStates.has(metadata.status))) &&
      (metadata.reason === undefined ||
        [
          "transient",
          "loading",
          "stale",
          "denied",
          "revoked",
          "closed",
        ].includes(String(metadata.reason))) &&
      (metadata.retryable === undefined ||
        typeof metadata.retryable === "boolean") &&
      (metadata.source === undefined ||
        ["load", "preload", "refresh", "readiness", "close"].includes(
          String(metadata.source),
        )) &&
      (metadata.joinedCallers === undefined ||
        (Number.isInteger(metadata.joinedCallers) &&
          Number(metadata.joinedCallers) > 0)) &&
      (metadata.durationMs === undefined ||
        (Number.isInteger(metadata.durationMs) &&
          Number(metadata.durationMs) >= 0));
    if (!metadataValueValid) {
      failures.push(
        `${label} telemetry metadata value is outside the explicit allowlist`,
      );
    }
    const serialized = JSON.stringify(metadata);
    if (sensitiveValues.some((value) => serialized.includes(value))) {
      failures.push(
        `${label} telemetry metadata contains a secret, ID, path, or content`,
      );
    }
  }
}

function validateNoPackageVersions(
  value: unknown,
  path: string,
  failures: string[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      validateNoPackageVersions(entry, `${path}[${index}]`, failures),
    );
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.replaceAll(/[-_]/g, "").toLowerCase();
    if (
      ["version", "packageversion", "adapterversion", "sdkversion"].includes(
        normalized,
      )
    ) {
      failures.push(`${path}.${key} is a forbidden package version field`);
    }
    validateNoPackageVersions(entry, `${path}.${key}`, failures);
  }
}

function validateCase(
  entryValue: unknown,
  index: number,
  sdkCorpus: JsonObject,
  failures: string[],
): JsonObject {
  const label = `cases[${index}]`;
  const entry = object(entryValue, label, failures);
  const operations = validateOperations(
    entry.operations,
    `${label}.operations`,
    failures,
  );
  const expected = object(entry.expected, `${label}.expected`, failures);
  const genericSdk = validateOutcome(
    expected.genericSdk,
    `${label}.expected.genericSdk`,
    failures,
  );
  const readiness = validateOutcome(
    expected.readiness,
    `${label}.expected.readiness`,
    failures,
  );
  validateCalls(
    expected.calls,
    operations,
    `${label}.expected.calls`,
    failures,
  );
  validateTransitions(
    expected.statusTransitions,
    genericSdk,
    operations,
    `${label}.expected.statusTransitions`,
    failures,
  );
  const nativeHook = object(
    expected.nativeHook,
    `${label}.expected.nativeHook`,
    failures,
  );
  if (typeof nativeHook.proceed !== "boolean") {
    failures.push(`${label}.expected.nativeHook.proceed must be boolean`);
  }
  if (nativeHook.proceed === true && !Object.hasOwn(readiness, "result")) {
    failures.push(`${label} cannot proceed when readiness rejects`);
  }
  if (nativeHook.proceed === false && !Object.hasOwn(readiness, "error")) {
    failures.push(
      `${label} must classify why readiness blocks the native hook`,
    );
  }
  if (Object.hasOwn(genericSdk, "error")) {
    if (JSON.stringify(genericSdk.error) !== JSON.stringify(readiness.error)) {
      failures.push(`${label} generic SDK and readiness errors must be exact`);
    }
  }
  validateRenderedRecords(
    expected.renderedRecords,
    genericSdk,
    sdkCorpus,
    `${label}.expected.renderedRecords`,
    failures,
  );
  validateTelemetry(expected, sdkCorpus, `${label}.expected`, failures);

  const closeAt = operations.find(
    (operation) => operation.kind === "close",
  )?.atMs;
  if (
    operations.some(
      (operation) =>
        typeof closeAt === "number" &&
        typeof operation.atMs === "number" &&
        operation.atMs > closeAt &&
        operation.kind !== "close",
    ) &&
    (genericSdk.error as JsonObject | undefined)?.code !==
      "LEARNING_REGISTRY_CLOSED"
  ) {
    failures.push(`${label} permits an operation created after close`);
  }
  return entry;
}

export function validateAdapterCorpus(
  corpusValue: unknown,
  sdkCorpusValue: unknown,
  packageJsonValue: unknown,
): string[] {
  const failures: string[] = [];
  const corpus = object(corpusValue, "corpus", failures);
  const sdkCorpus = object(sdkCorpusValue, "registry-sdk-v1", failures);
  const packageJson = object(packageJsonValue, "package.json", failures);

  if (corpus.schemaVersion !== 1) failures.push("schemaVersion must be 1");
  if (corpus.contractVersion !== "registry-adapters-v1") {
    failures.push("contractVersion must be registry-adapters-v1");
  }
  if (corpus.sourceCorpus !== "registry-sdk-v1.json") {
    failures.push("sourceCorpus must be registry-sdk-v1.json");
  }
  const distribution = object(corpus.distribution, "distribution", failures);
  if (
    distribution.repositoryTestOnly !== true ||
    distribution.publishedExport !== false ||
    distribution.runtimeDependency !== false
  ) {
    failures.push("the adapter corpus must remain repository-test-only");
  }
  validateNoPackageVersions(corpus, "corpus", failures);

  const fixtures = object(corpus.fixtures, "fixtures", failures);
  const sdkIdentity = object(sdkCorpus.identity, "sdk.identity", failures);
  const sdkProjection = object(
    sdkCorpus.projection,
    "sdk.projection",
    failures,
  );
  const sdkEntries = array(
    sdkProjection.entries,
    "sdk.projection.entries",
    failures,
  );
  const sdkEntry = object(sdkEntries[0], "sdk.projection.entries[0]", failures);
  const sdkBundle = object(sdkCorpus.bundle, "sdk.bundle", failures);
  const fixturePairs: Array<[string, unknown]> = [
    ["learningContainerId", sdkIdentity.learningContainerId],
    ["skillId", sdkIdentity.skillId],
    ["versionId", sdkIdentity.versionId],
    ["registryRevision", sdkProjection.registryRevision],
    ["etag", sdkProjection.etag],
    ["bundleSha256", sdkBundle.sha256],
    ["bundleByteLength", sdkBundle.byteLength],
    ["instructionText", sdkBundle.fileContents],
    ["skillPosition", sdkEntry.position],
    ["skillName", sdkEntry.name],
    ["skillDescription", sdkEntry.description],
  ];
  for (const [field, expected] of fixturePairs) {
    if (fixtures[field] !== expected)
      failures.push(`fixtures.${field} drifted from SDK`);
  }
  if (
    Buffer.byteLength(String(fixtures.instructionText), "utf8") !==
    fixtures.instructionByteLength
  ) {
    failures.push("instruction rendering bytes drifted from SDK fixture");
  }
  if (
    typeof sdkBundle.base64 !== "string" ||
    Buffer.from(sdkBundle.base64, "base64").byteLength !==
      fixtures.bundleByteLength
  ) {
    failures.push("source bundle byteLength is not exact");
  }

  const cases = array(corpus.cases, "cases", failures).map((entry, index) =>
    validateCase(entry, index, sdkCorpus, failures),
  );
  const names = cases.map((entry) => entry.name);
  if (names.length !== 35)
    failures.push(`expected 35 cases, received ${names.length}`);
  if (new Set(names).size !== names.length)
    failures.push("case names must be unique");
  if (JSON.stringify(names) !== JSON.stringify(requiredCaseNames)) {
    failures.push("cases must contain exactly the required canonical order");
  }

  const denialSources = cases.flatMap((entry) =>
    entry.permanentDenialSource === undefined
      ? []
      : [entry.permanentDenialSource],
  );
  if (
    JSON.stringify(denialSources) !== JSON.stringify(permanentDenialSources)
  ) {
    failures.push(
      "permanent denial sources must each be classified exactly once",
    );
  }
  for (const entry of cases.filter(
    (candidate) => candidate.permanentDenialSource !== undefined,
  )) {
    const expected = object(
      entry.expected,
      `${String(entry.name)}.expected`,
      failures,
    );
    const error = object(
      object(expected.genericSdk, "genericSdk", failures).error,
      "genericSdk.error",
      failures,
    );
    if (
      error.retryable !== false ||
      object(expected.nativeHook, "nativeHook", failures).proceed !== false
    ) {
      failures.push(
        `${String(entry.name)} is not a permanent fail-closed denial`,
      );
    }
  }

  for (const [caseName, code] of adapterValidationCodes) {
    const caseEntry = cases.find((entry) => entry.name === caseName);
    const expected = object(
      caseEntry?.expected,
      `${caseName}.expected`,
      failures,
    );
    const genericSdk = object(
      expected.genericSdk,
      `${caseName}.genericSdk`,
      failures,
    );
    const error = object(genericSdk.error, `${caseName}.error`, failures);
    if (error.code !== code)
      failures.push(`${caseName} error code must be ${code}`);
    if (
      object(expected.nativeHook, `${caseName}.nativeHook`, failures)
        .proceed !== false ||
      array(expected.renderedRecords, `${caseName}.renderedRecords`, failures)
        .length !== 0
    ) {
      failures.push(
        `${caseName} must fail the whole load before native routing`,
      );
    }
    if (caseName === "script-disabled") {
      const operations = array(
        caseEntry?.operations,
        "script-disabled.operations",
        failures,
      ).map((entry) => object(entry, "script-disabled.operation", failures));
      if (
        operations.at(-1)?.kind !== "reject-script" ||
        operations.some((operation) => operation.kind === "render")
      ) {
        failures.push(
          "script-disabled must terminate at reject-script before rendering",
        );
      }
    }
  }

  const revoked = object(
    cases.find((entry) => entry.name === "revoked")?.expected,
    "revoked.expected",
    failures,
  );
  const revokedResult = object(
    object(revoked.genericSdk, "revoked.genericSdk", failures).result,
    "revoked.result",
    failures,
  );
  const revokedReadiness = object(
    revoked.readiness,
    "revoked.readiness",
    failures,
  );
  const revokedTransitions = array(
    revoked.statusTransitions,
    "revoked.statusTransitions",
    failures,
  ).map((entry) => object(entry, "revoked.transition", failures));
  if (
    revokedResult.state !== "revoked" ||
    revokedResult.skillCount !== 0 ||
    !Object.hasOwn(revokedReadiness, "result") ||
    object(revoked.nativeHook, "revoked.nativeHook", failures).proceed !==
      true ||
    array(revoked.renderedRecords, "revoked.renderedRecords", failures)
      .length !== 0 ||
    !revokedTransitions.some(
      (transition) =>
        transition.from === "loading" && transition.to === "revoked",
    )
  ) {
    failures.push("revoked must remain authorized-empty and proceed natively");
  }

  const cachedPreload = cases.find(
    (entry) => entry.name === "explicit-cached-preload",
  );
  const preloadOperations = array(
    cachedPreload?.operations,
    "explicit-cached-preload.operations",
    failures,
  ).map((entry) =>
    object(entry, "explicit-cached-preload.operation", failures),
  );
  const preloadCalls = object(
    object(
      cachedPreload?.expected,
      "explicit-cached-preload.expected",
      failures,
    ).calls,
    "explicit-cached-preload.calls",
    failures,
  );
  const preloadClient = object(
    preloadCalls.client,
    "explicit-cached-preload.client",
    failures,
  );
  if (
    preloadOperations.length !== 1 ||
    preloadOperations[0]?.kind !== "cached-preload" ||
    preloadClient.cached !== 1 ||
    preloadClient.network !== 0
  ) {
    failures.push(
      "explicit-cached-preload must be one cached call and zero network calls",
    );
  }

  const limits = object(fixtures.limits, "fixtures.limits", failures);
  if (limits.throttleWindowMs !== 30000) {
    failures.push("throttleWindowMs must be hard-coded to 30000");
  }
  const retry = cases.find(
    (entry) => entry.name === "retry-after-failed-throttle-window",
  );
  const retryOperations = array(
    retry?.operations,
    "retry.operations",
    failures,
  ).map((entry) => object(entry, "retry.operation", failures));
  const startRequests = retryOperations.filter(
    (operation) =>
      operation.kind === "registry-request" &&
      operation.atMs === 0 &&
      operation.outcome === "failed",
  );
  const insideChecks = retryOperations.filter(
    (operation) =>
      operation.atMs === 29999 &&
      operation.kind === "throttle-check" &&
      operation.networkCall === false,
  );
  const boundaryRequests = retryOperations.filter(
    (operation) =>
      operation.kind === "registry-request" && operation.atMs === 30000,
  );
  const networkInsideWindow = retryOperations.filter(
    (operation) =>
      ["registry-request", "projection-request", "bundle-request"].includes(
        String(operation.kind),
      ) &&
      Number(operation.atMs) > 0 &&
      Number(operation.atMs) < 30000,
  );
  if (
    startRequests.length !== 1 ||
    insideChecks.length !== 1 ||
    boundaryRequests.length !== 1 ||
    networkInsideWindow.length !== 0
  ) {
    failures.push(
      "retry must use the exact 30000ms boundary with no 29999ms call",
    );
  }

  const telemetryExpected = object(
    cases.find((entry) => entry.name === "telemetry-sink-failure-singleflight")
      ?.expected,
    "telemetry-sink-failure-singleflight.expected",
    failures,
  );
  const singleflight = object(
    telemetryExpected.singleflight,
    "telemetry-sink-failure-singleflight.singleflight",
    failures,
  );
  const callers = array(
    singleflight.callers,
    "singleflight.callers",
    failures,
  ).map((entry) => object(entry, "singleflight.caller", failures));
  if (
    callers.length !== 2 ||
    singleflight.registryCalls !== 1 ||
    callers.some(
      (caller) =>
        caller.causeIdentity !== singleflight.sinkExceptionIdentity ||
        caller.rejectionIdentity !== singleflight.sinkExceptionIdentity,
    )
  ) {
    failures.push(
      "singleflight rejections must equal the one sink exception identity",
    );
  }

  const scripts = object(packageJson.scripts, "package.json scripts", failures);
  if (
    scripts["verify:adapter-conformance"] !==
    "tsx scripts/verify-adapter-corpus.ts"
  ) {
    failures.push(
      "package script verify:adapter-conformance is missing or changed",
    );
  }
  const exports = object(packageJson.exports, "package.json exports", failures);
  if (
    Object.keys(exports).some((key) => key.includes("registry-adapters-v1"))
  ) {
    failures.push("the repository-only corpus cannot be a package export");
  }
  if (
    !array(packageJson.files, "package.json files", failures).includes(
      "!conformance/registry-adapters-v1.json",
    )
  ) {
    failures.push(
      "the repository-only corpus must be excluded from published files",
    );
  }
  return failures;
}

function run(): void {
  const failures = validateAdapterCorpus(
    readJson(corpusPath),
    readJson(sdkCorpusPath),
    readJson(packageJsonPath),
  );
  if (failures.length > 0) {
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`${requiredCaseNames.length} adapter conformance cases valid`);
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  run();
}
