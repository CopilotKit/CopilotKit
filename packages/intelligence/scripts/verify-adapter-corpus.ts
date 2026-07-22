import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

const allowedTransitions = new Set([
  "idle>loading",
  "idle>closed",
  "ready>loading",
  "ready>closed",
  "loading>ready",
  "loading>stale",
  "loading>denied",
  "loading>error",
  "loading>closed",
  "stale>loading",
  "stale>closed",
  "stale>denied",
  "denied>closed",
  "error>loading",
  "error>closed",
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

function nonNegativeInteger(
  value: unknown,
  label: string,
  failures: string[],
): number {
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
): void {
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
  if (hasResult) object(outcome.result, `${label}.result`, failures);
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
    nonNegativeInteger(operation.atMs, `${label}[${index}].atMs`, failures),
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

function validateTransitions(
  value: unknown,
  label: string,
  failures: string[],
): void {
  const transitions = array(value, label, failures).map((entry, index) =>
    object(entry, `${label}[${index}]`, failures),
  );
  let previousAtMs = -1;
  let previousTo: unknown;
  for (const [index, transition] of transitions.entries()) {
    const atMs = nonNegativeInteger(
      transition.atMs,
      `${label}[${index}].atMs`,
      failures,
    );
    if (atMs <= previousAtMs) {
      failures.push(`${label} must be ordered without duplicate timestamps`);
    }
    const from = transition.from;
    const to = transition.to;
    if (typeof from !== "string" || typeof to !== "string") {
      failures.push(`${label}[${index}] must name from/to states`);
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
}

function validateCounts(
  value: unknown,
  label: string,
  failures: string[],
): void {
  const calls = object(value, label, failures);
  const client = object(calls.client, `${label}.client`, failures);
  const routing = object(calls.routing, `${label}.routing`, failures);
  nonNegativeInteger(client.projection, `${label}.client.projection`, failures);
  nonNegativeInteger(client.bundle, `${label}.client.bundle`, failures);
  nonNegativeInteger(routing.readiness, `${label}.routing.readiness`, failures);
  nonNegativeInteger(
    routing.nativeHook,
    `${label}.routing.nativeHook`,
    failures,
  );
}

function validateRenderedRecords(
  recordsValue: unknown,
  genericSdk: JsonObject,
  label: string,
  failures: string[],
): void {
  const records = array(recordsValue, label, failures).map((entry, index) =>
    object(entry, `${label}[${index}]`, failures),
  );
  let aggregateByteLength = 0;
  for (const [index, record] of records.entries()) {
    if (record.position !== index) {
      failures.push(`${label}[${index}].position must preserve exact order`);
    }
    if (typeof record.text !== "string") {
      failures.push(`${label}[${index}].text must be a string`);
      continue;
    }
    const actualBytes = Buffer.byteLength(record.text, "utf8");
    if (record.byteLength !== actualBytes) {
      failures.push(
        `${label}[${index}] declares ${String(record.byteLength)} bytes but renders ${actualBytes}`,
      );
    }
    aggregateByteLength += actualBytes;
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
      result.aggregateByteLength !== aggregateByteLength
    ) {
      failures.push(
        `${label} bytes differ from generic SDK aggregateByteLength`,
      );
    }
  }
}

function validateCase(
  value: unknown,
  index: number,
  failures: string[],
): JsonObject {
  const label = `cases[${index}]`;
  const entry = object(value, label, failures);
  const operations = validateOperations(
    entry.operations,
    `${label}.operations`,
    failures,
  );
  const expected = object(entry.expected, `${label}.expected`, failures);
  validateCounts(expected.calls, `${label}.expected.calls`, failures);
  validateTransitions(
    expected.statusTransitions,
    `${label}.expected.statusTransitions`,
    failures,
  );
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
    if (!Object.hasOwn(readiness, "error")) {
      failures.push(`${label} is missing its readiness error classification`);
    } else if (
      JSON.stringify(genericSdk.error) !== JSON.stringify(readiness.error)
    ) {
      failures.push(`${label} generic SDK and readiness errors must be exact`);
    }
  }

  const telemetryNames = array(
    expected.telemetryNames,
    `${label}.expected.telemetryNames`,
    failures,
  );
  const sensitiveTelemetry =
    /(^|[._-])(authorization|bearer|secret|token|project|container|skill|path|content|id)($|[._-])|[0-9a-f]{8}-[0-9a-f-]{27,}/i;
  for (const [telemetryIndex, name] of telemetryNames.entries()) {
    if (typeof name !== "string" || name.length === 0) {
      failures.push(
        `${label}.expected.telemetryNames[${telemetryIndex}] is invalid`,
      );
    } else if (sensitiveTelemetry.test(name)) {
      failures.push(
        `${label} telemetry bears a secret, identifier, or payload field`,
      );
    }
  }
  validateRenderedRecords(
    expected.renderedRecords,
    genericSdk,
    `${label}.expected.renderedRecords`,
    failures,
  );

  const closeAt = operations.find(
    (operation) => operation.kind === "close",
  )?.atMs;
  const hasPostCloseOperation = operations.some(
    (operation) =>
      typeof closeAt === "number" &&
      typeof operation.atMs === "number" &&
      operation.atMs > closeAt &&
      operation.kind !== "close",
  );
  if (hasPostCloseOperation) {
    const error = object(
      genericSdk.error,
      `${label}.expected.genericSdk.error`,
      failures,
    );
    if (error.code !== "LEARNING_REGISTRY_CLOSED") {
      failures.push(`${label} permits an operation created after close`);
    }
  }
  return entry;
}

function verifyAdapterCorpus(): string[] {
  const failures: string[] = [];
  const corpus = readJson(corpusPath);
  const sdkCorpus = readJson(sdkCorpusPath);
  const packageJson = readJson(packageJsonPath);

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

  const cases = array(corpus.cases, "cases", failures).map((entry, index) =>
    validateCase(entry, index, failures),
  );
  const names = cases.map((entry) => entry.name);
  if (names.length !== requiredCaseNames.length) {
    failures.push(`expected 35 cases, received ${names.length}`);
  }
  if (new Set(names).size !== names.length)
    failures.push("case names must be unique");
  for (const required of requiredCaseNames) {
    if (!names.includes(required))
      failures.push(`missing required case ${required}`);
  }
  for (const name of names) {
    if (
      !requiredCaseNames.includes(name as (typeof requiredCaseNames)[number])
    ) {
      failures.push(`unexpected case ${String(name)}`);
    }
  }
  if (JSON.stringify(names) !== JSON.stringify(requiredCaseNames)) {
    failures.push("cases must preserve the canonical order");
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
    const genericSdk = object(expected.genericSdk, "genericSdk", failures);
    const error = object(genericSdk.error, "genericSdk.error", failures);
    const nativeHook = object(expected.nativeHook, "nativeHook", failures);
    if (error.retryable !== false || nativeHook.proceed !== false) {
      failures.push(
        `${String(entry.name)} is not a permanent fail-closed denial`,
      );
    }
  }

  const fixtures = object(corpus.fixtures, "fixtures", failures);
  const sdkProjection = object(
    sdkCorpus.projection,
    "sdk.projection",
    failures,
  );
  const sdkBundle = object(sdkCorpus.bundle, "sdk.bundle", failures);
  if (fixtures.registryRevision !== sdkProjection.registryRevision) {
    failures.push("registryRevision drifted from registry-sdk-v1.json");
  }
  if (fixtures.etag !== sdkProjection.etag) {
    failures.push("etag drifted from registry-sdk-v1.json");
  }
  if (fixtures.bundleSha256 !== sdkBundle.sha256) {
    failures.push("bundleSha256 drifted from registry-sdk-v1.json");
  }
  if (fixtures.bundleByteLength !== sdkBundle.byteLength) {
    failures.push("bundleByteLength drifted from registry-sdk-v1.json");
  }
  if (
    typeof sdkBundle.base64 !== "string" ||
    Buffer.from(sdkBundle.base64, "base64").byteLength !==
      fixtures.bundleByteLength
  ) {
    failures.push("source bundle byteLength is not exact");
  }
  if (
    fixtures.instructionText !== sdkBundle.fileContents ||
    Buffer.byteLength(String(fixtures.instructionText), "utf8") !==
      fixtures.instructionByteLength
  ) {
    failures.push(
      "instruction rendering bytes drifted from registry-sdk-v1.json",
    );
  }

  const limits = object(fixtures.limits, "fixtures.limits", failures);
  const limitCases = [
    ["too-many-skills", "validate-count", "maximumSkills"],
    [
      "skill-md-too-large",
      "validate-instruction-bytes",
      "maximumInstructionBytes",
    ],
    [
      "aggregate-too-large",
      "validate-aggregate-bytes",
      "maximumAggregateBytes",
    ],
  ] as const;
  for (const [caseName, operationKind, limitName] of limitCases) {
    const entry = cases.find((candidate) => candidate.name === caseName);
    const operations = array(
      entry?.operations,
      `${caseName}.operations`,
      failures,
    );
    const operation = operations
      .map((candidate) => object(candidate, `${caseName}.operation`, failures))
      .find((candidate) => candidate.kind === operationKind);
    if (
      operation?.observed !== Number(limits[limitName]) + 1 ||
      !Number.isInteger(limits[limitName])
    ) {
      failures.push(
        `${caseName} must exercise the exact first rejected boundary`,
      );
    }
  }

  const retryCase = cases.find(
    (entry) => entry.name === "retry-after-failed-throttle-window",
  );
  const retryOperations = array(
    retryCase?.operations,
    "retry.operations",
    failures,
  ).map((entry) => object(entry, "retry.operation", failures));
  const throttleWindow = Number(limits.throttleWindowMs);
  const requestsInsideWindow = retryOperations.filter(
    (operation) =>
      operation.kind === "registry-request" &&
      Number(operation.atMs) > 0 &&
      Number(operation.atMs) < throttleWindow,
  );
  const requestsAtBoundary = retryOperations.filter(
    (operation) =>
      operation.kind === "registry-request" &&
      operation.atMs === throttleWindow,
  );
  if (requestsInsideWindow.length !== 0 || requestsAtBoundary.length !== 1) {
    failures.push(
      "retry must make no request inside 30s and exactly one at the boundary",
    );
  }

  const telemetryCase = cases.find(
    (entry) => entry.name === "telemetry-sink-failure-singleflight",
  );
  const telemetryExpected = object(
    telemetryCase?.expected,
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
  const rejectionIdentities = new Set(
    callers.map((caller) => caller.rejectionIdentity),
  );
  const causeIdentities = new Set(
    callers.map((caller) => caller.causeIdentity),
  );
  const telemetryCalls = object(
    telemetryExpected.calls,
    "telemetry.calls",
    failures,
  );
  const telemetryClientCalls = object(
    telemetryCalls.client,
    "telemetry.client",
    failures,
  );
  if (
    callers.length !== 2 ||
    singleflight.registryCalls !== 1 ||
    telemetryClientCalls.projection !== 1 ||
    rejectionIdentities.size !== 1 ||
    causeIdentities.size !== 1 ||
    !causeIdentities.has(singleflight.sinkExceptionIdentity)
  ) {
    failures.push(
      "telemetry-failure callers must share one Registry call, sink exception, and rejection",
    );
  }

  const serializedCorpus = JSON.stringify(corpus);
  if (/"packageVersion"|"adapterVersion"/.test(serializedCorpus)) {
    failures.push("the neutral corpus cannot contain package versions");
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
  const publishedFiles = array(
    packageJson.files,
    "package.json files",
    failures,
  );
  if (!publishedFiles.includes("!conformance/registry-adapters-v1.json")) {
    failures.push(
      "the repository-only corpus must be excluded from published files",
    );
  }
  const dependencies = object(
    packageJson.dependencies,
    "package.json dependencies",
    failures,
  );
  if (JSON.stringify(dependencies).includes("registry-adapters-v1")) {
    failures.push("released code cannot depend on the repository-only corpus");
  }

  return failures;
}

const failures = verifyAdapterCorpus();
if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`${requiredCaseNames.length} adapter conformance cases valid`);
}
