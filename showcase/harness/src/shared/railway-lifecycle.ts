/** Operator-reviewed policy; lifecycle receipts cannot approve their own images. */
export interface RailwayLifecyclePolicy {
  readonly projectId: string;
  readonly forbiddenEnvironmentIds: readonly string[];
  readonly permanentServices: readonly {
    readonly name: string;
    readonly serviceId: string;
  }[];
  readonly approvedImages: readonly string[];
}

export type RunPhase =
  | "setup"
  | "ready"
  | "teardown"
  | "complete"
  | "interrupted";

/** Exact provider IDs already returned to the lifecycle writer, never creation intent. */
export interface RunRecord {
  readonly runId: string;
  readonly projectId: string;
  readonly environmentId: string;
  readonly startedAt: string;
  readonly expiresAt: string;
  readonly phase: RunPhase;
  readonly services: readonly {
    readonly name: string;
    readonly serviceId: string;
    readonly expectedImage: string;
  }[];
  readonly resources: readonly { readonly kind: string; readonly id: string }[];
}

export interface RunRecordsSnapshot {
  readonly schemaVersion: 1;
  readonly runs: readonly RunRecord[];
}

export interface LifecycleIssue {
  readonly code: string;
  readonly message: string;
  readonly runId?: string;
  readonly serviceId?: string;
  readonly environmentId?: string;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: LifecycleIssue[] };
export type LifecycleEvidence =
  | { readonly status: "unavailable" }
  | { readonly status: "valid"; readonly snapshot: RunRecordsSnapshot }
  | { readonly status: "invalid"; readonly issues: readonly LifecycleIssue[] };

export interface ObservedRailwayService {
  readonly name: string;
  readonly serviceId: string;
  readonly environmentId: string;
  readonly image: string | null;
}

export interface RailwayInventoryInput {
  readonly policy: RailwayLifecyclePolicy;
  readonly evidence: LifecycleEvidence;
  readonly now: Date;
  readonly projectId: string;
  /** Only environments with a complete service inventory belong here. */
  readonly observedEnvironmentIds: readonly string[];
  readonly services: readonly ObservedRailwayService[];
}

export interface RailwayInventoryClassification {
  readonly services: (ObservedRailwayService & {
    readonly classification: "permanent" | "owned-disposable" | "unknown";
    readonly runId?: string;
  })[];
  readonly diagnostics: LifecycleIssue[];
  readonly failures: LifecycleIssue[];
  /** Only observed services with verified scope and name receive exclusions. */
  readonly excludedServices: {
    readonly projectId: string;
    readonly environmentId: string;
    readonly serviceId: string;
  }[];
  /** Reporting only. Never skip inventory or grant mutation authority by environment. */
  readonly excludedEnvironments: {
    readonly projectId: string;
    readonly environmentId: string;
  }[];
}

/** Internal validation failure carrying a safe, typed issue without record contents. */
class InvalidLifecycleData extends Error {
  constructor(readonly issue: LifecycleIssue) {
    super(issue.message);
  }
}

/** Stop validation at the first unsafe field. */
function invalid(code: string, message: string): never {
  throw new InvalidLifecycleData({ code, message });
}

/** Require exactly the documented keys to catch misspellings and unsafe extensions. */
function object(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("invalid-shape", `${path} must be an object`);
  const result = value as Record<string, unknown>;
  if (
    Object.keys(result).some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(result, key))
  )
    invalid(
      "invalid-fields",
      `${path} must contain exactly: ${keys.join(", ")}`,
    );
  return result;
}

/** Require a nonempty string with no invisible surrounding whitespace. */
function string(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim())
    invalid("invalid-string", `${path} must be a nonempty trimmed string`);
  return value;
}

/** Require an array without coercing missing fields to empty lists. */
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value))
    invalid("invalid-array", `${path} must be an array`);
  return value;
}

/** Enforce uniqueness within the supplied ownership or policy namespace. */
function unique(seen: Set<string>, value: string, path: string): void {
  if (seen.has(value))
    invalid("duplicate-claim", `${path} contains a duplicate identity`);
  seen.add(value);
}

/** Check immutable registry/repository digest references, including nested paths. */
function immutableImage(value: string): boolean {
  return /^[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[0-9]+)?\/[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*@sha256:[a-f0-9]{64}$/.test(
    value,
  );
}

/** Reject normalized impossible dates as well as local/offset timestamp forms. */
function timestamp(value: unknown, path: string): string {
  const text = string(value, path);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text))
    invalid("invalid-date", `${path} must be an explicit UTC ISO timestamp`);
  const millis = Date.parse(text);
  if (
    !Number.isFinite(millis) ||
    new Date(millis).toISOString() !== text.replace(/(?<!\.\d{3})Z$/, ".000Z")
  )
    invalid("invalid-date", `${path} is not a valid calendar timestamp`);
  return text;
}

/** Convert expected validation errors to data; programming errors still surface. */
function validated<T>(read: () => T): ValidationResult<T> {
  try {
    return { ok: true, value: read() };
  } catch (error) {
    if (error instanceof InvalidLifecycleData)
      return { ok: false, issues: [error.issue] };
    throw error;
  }
}

/** Parse the independent committed policy before interpreting ownership evidence. */
export function parseRailwayLifecyclePolicy(
  input: unknown,
): ValidationResult<RailwayLifecyclePolicy> {
  return validated(() => {
    const root = object(
      input,
      [
        "projectId",
        "forbiddenEnvironmentIds",
        "permanentServices",
        "approvedImages",
      ],
      "policy",
    );
    const envIds = new Set<string>();
    const serviceIds = new Set<string>();
    const names = new Set<string>();
    const images = new Set<string>();
    return {
      projectId: string(root.projectId, "policy.projectId"),
      forbiddenEnvironmentIds: array(
        root.forbiddenEnvironmentIds,
        "policy.forbiddenEnvironmentIds",
      ).map((value) => {
        const id = string(value, "forbidden environment ID");
        unique(envIds, id, "forbiddenEnvironmentIds");
        return id;
      }),
      permanentServices: array(
        root.permanentServices,
        "policy.permanentServices",
      ).map((value) => {
        const service = object(
          value,
          ["name", "serviceId"],
          "permanent service",
        );
        const name = string(service.name, "permanent service name");
        const serviceId = string(service.serviceId, "permanent service ID");
        unique(names, name, "permanent service names");
        unique(serviceIds, serviceId, "permanent service IDs");
        return { name, serviceId };
      }),
      approvedImages: array(root.approvedImages, "policy.approvedImages").map(
        (value) => {
          const image = string(value, "approved image");
          if (!immutableImage(image))
            invalid(
              "invalid-approved-image",
              "approvedImages must contain immutable registry/repository digest references",
            );
          unique(images, image, "approvedImages");
          return image;
        },
      ),
    };
  });
}

/** Validate one atomic snapshot, including ownership collisions across retained runs. */
export function parseRunRecordsSnapshot(
  input: unknown,
  policy: RailwayLifecyclePolicy,
  now: Date,
): ValidationResult<RunRecordsSnapshot> {
  const parsedPolicy = parseRailwayLifecyclePolicy(policy);
  if (!parsedPolicy.ok) return parsedPolicy;
  return validated(() => {
    if (!Number.isFinite(now.getTime()))
      invalid("invalid-now", "now must be a valid date");
    const root = object(input, ["schemaVersion", "runs"], "snapshot");
    if (root.schemaVersion !== 1)
      invalid("unsupported-schema-version", "snapshot.schemaVersion must be 1");
    const runIds = new Set<string>();
    const serviceIds = new Set<string>();
    const resourceIds = new Set<string>();
    let activeRuns = 0;
    const runs = array(root.runs, "snapshot.runs").map(
      (runValue): RunRecord => {
        const run = object(
          runValue,
          [
            "runId",
            "projectId",
            "environmentId",
            "startedAt",
            "expiresAt",
            "phase",
            "services",
            "resources",
          ],
          "run",
        );
        const runId = string(run.runId, "run.runId");
        unique(runIds, runId, "run IDs");
        const projectId = string(run.projectId, "run.projectId");
        const environmentId = string(run.environmentId, "run.environmentId");
        if (projectId !== policy.projectId)
          invalid("project-mismatch", "run project must match policy project");
        if (policy.forbiddenEnvironmentIds.includes(environmentId))
          invalid(
            "forbidden-environment",
            "disposable run names a forbidden environment",
          );
        unique(
          resourceIds,
          `environment:${environmentId}`,
          "environment ownership",
        );
        const startedAt = timestamp(run.startedAt, "run.startedAt");
        const expiresAt = timestamp(run.expiresAt, "run.expiresAt");
        const start = Date.parse(startedAt);
        const expiry = Date.parse(expiresAt);
        if (start > now.getTime())
          invalid("future-start", "run.startedAt cannot be in the future");
        if (expiry <= start || expiry - start > 60 * 60 * 1000)
          invalid(
            "invalid-run-duration",
            "run expiry must follow its start by at most 60 minutes",
          );
        const phase = string(run.phase, "run.phase") as RunPhase;
        if (
          !["setup", "ready", "teardown", "complete", "interrupted"].includes(
            phase,
          )
        )
          invalid("invalid-phase", "run.phase is unsupported");
        if (
          ["setup", "ready", "teardown"].includes(phase) &&
          expiry > now.getTime()
        )
          activeRuns++;
        const names = new Set<string>();
        const services = array(run.services, "run.services").map((value) => {
          const service = object(
            value,
            ["name", "serviceId", "expectedImage"],
            "run service",
          );
          const name = string(service.name, "service.name");
          const serviceId = string(service.serviceId, "service.serviceId");
          const expectedImage = string(
            service.expectedImage,
            "service.expectedImage",
          );
          unique(names, name, "run service names");
          unique(serviceIds, serviceId, "service ownership");
          if (
            policy.permanentServices.some(
              (entry) => entry.name === name || entry.serviceId === serviceId,
            )
          )
            invalid(
              "permanent-collision",
              "disposable service collides with a permanent name or ID",
            );
          if (
            !immutableImage(expectedImage) ||
            !policy.approvedImages.includes(expectedImage)
          )
            invalid(
              "unapproved-image",
              "disposable expected image must equal a separately approved immutable pin",
            );
          return { name, serviceId, expectedImage };
        });
        const localResources = new Set<string>();
        const resources = array(run.resources, "run.resources").map((value) => {
          const resource = object(value, ["kind", "id"], "run resource");
          const kind = string(resource.kind, "resource.kind");
          const id = string(resource.id, "resource.id");
          if (kind === "service")
            invalid(
              "invalid-resource-kind",
              "service ownership belongs in run.services",
            );
          if (kind === "environment" && id !== environmentId)
            invalid(
              "environment-mismatch",
              "environment resource must match run environment",
            );
          const key = `${kind}:${id}`;
          unique(localResources, key, "run resources");
          if (kind !== "environment")
            unique(resourceIds, key, "resource ownership");
          return { kind, id };
        });
        return {
          runId,
          projectId,
          environmentId,
          startedAt,
          expiresAt,
          phase,
          services,
          resources,
        };
      },
    );
    if (activeRuns > 1)
      invalid(
        "overlapping-active-runs",
        "only one active unexpired disposable run is allowed",
      );
    return { schemaVersion: 1, runs };
  });
}

/** Classify read-only inventory. Exclusion is separate from image/lifecycle failures. */
export function classifyRailwayInventory(
  input: RailwayInventoryInput,
): RailwayInventoryClassification {
  const { policy, evidence, now, projectId } = input;
  const failures: LifecycleIssue[] = [];
  const diagnostics: LifecycleIssue[] = [];
  const parsedPolicy = parseRailwayLifecyclePolicy(policy);
  const projectMatches =
    parsedPolicy.ok && projectId === parsedPolicy.value.projectId;
  let runs: readonly RunRecord[] = [];
  if (!parsedPolicy.ok) failures.push(...parsedPolicy.issues);
  else if (!projectMatches)
    failures.push({
      code: "project-mismatch",
      message: "observed project must match policy project",
    });
  if (evidence.status === "invalid") failures.push(...evidence.issues);
  else if (evidence.status === "unavailable")
    diagnostics.push({
      code: "evidence-unavailable",
      message:
        "No configured lifecycle evidence; disposable exemptions are unavailable",
    });
  else if (parsedPolicy.ok) {
    const parsed = parseRunRecordsSnapshot(
      evidence.snapshot,
      parsedPolicy.value,
      now,
    );
    if (!parsed.ok) failures.push(...parsed.issues);
    else if (projectMatches) runs = parsed.value.runs;
  }
  const excludedEnvironments = runs.map((run) => ({
    projectId,
    environmentId: run.environmentId,
  }));
  const services = input.services.map(
    (service): RailwayInventoryClassification["services"][number] => {
      const run = runs.find(
        (candidate) =>
          candidate.environmentId === service.environmentId &&
          candidate.services.some(
            (owned) =>
              owned.serviceId === service.serviceId &&
              owned.name === service.name,
          ),
      );
      if (run) {
        const expected = run.services.find(
          (owned) => owned.serviceId === service.serviceId,
        )!;
        const context = {
          runId: run.runId,
          serviceId: service.serviceId,
          environmentId: service.environmentId,
        };
        if (service.image !== expected.expectedImage)
          failures.push({
            code: "image-mismatch",
            message:
              "owned service image differs from its expected approved pin",
            ...context,
          });
        if (
          Date.parse(run.expiresAt) <= now.getTime() ||
          run.phase === "complete" ||
          run.phase === "interrupted"
        )
          failures.push({
            code: "leftover-service",
            message: "owned service remains after expiry or a terminal phase",
            ...context,
          });
        return {
          ...service,
          classification: "owned-disposable",
          runId: run.runId,
        };
      }
      if (
        projectMatches &&
        policy.permanentServices.some(
          (entry) =>
            entry.name === service.name &&
            entry.serviceId === service.serviceId,
        )
      )
        return { ...service, classification: "permanent" };
      failures.push({
        code: "unknown-service",
        message: "service has no exact permanent or disposable ownership match",
        serviceId: service.serviceId,
        environmentId: service.environmentId,
      });
      return { ...service, classification: "unknown" };
    },
  );
  const excludedServices = services
    .filter((service) => service.classification === "owned-disposable")
    .map((service) => ({
      projectId,
      environmentId: service.environmentId,
      serviceId: service.serviceId,
    }));
  for (const run of runs) {
    if (run.phase === "setup" && Date.parse(run.expiresAt) <= now.getTime())
      failures.push({
        code: "setup-expired",
        message: "setup run expired before reaching readiness",
        runId: run.runId,
        environmentId: run.environmentId,
      });
    if (run.resources.length)
      diagnostics.push({
        code: "non-service-presence-unverified",
        message:
          "service inventory cannot establish whether recorded non-service resources still exist",
        runId: run.runId,
        environmentId: run.environmentId,
      });
    if (
      run.phase === "ready" &&
      input.observedEnvironmentIds.includes(run.environmentId)
    ) {
      for (const service of run.services) {
        if (
          !services.some(
            (observed) =>
              observed.classification === "owned-disposable" &&
              observed.runId === run.runId &&
              observed.serviceId === service.serviceId,
          )
        )
          failures.push({
            code: "ready-service-missing",
            message:
              "ready run service is absent from its completely observed environment",
            runId: run.runId,
            serviceId: service.serviceId,
            environmentId: run.environmentId,
          });
      }
    }
  }
  return {
    services,
    diagnostics,
    failures,
    excludedServices,
    excludedEnvironments,
  };
}
