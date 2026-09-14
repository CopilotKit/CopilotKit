/** A bounded page in the Inspector Learning snapshot. */
export interface InspectorLearningPage<T> {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
  readonly items: readonly T[];
}

export type InspectorLearningEvidence =
  | {
      readonly status: "available";
      readonly threadId: string;
      readonly threadName: string | null;
      readonly messageIds: readonly string[];
      readonly updatedAt: string;
    }
  | { readonly status: "unavailable" };

export interface InspectorLearningInsight {
  readonly id: string;
  readonly statement: string;
  readonly impact: string;
  readonly totalThreadCount: number;
  readonly evidenceTruncated: boolean;
  readonly evidence: readonly InspectorLearningEvidence[];
}

export interface InspectorLearningSkill {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly revision: number;
  readonly skillMd: string;
  readonly sourceInsight: InspectorLearningInsight | null;
}

export interface InspectorLearningSnapshotV1 {
  readonly schemaVersion: 1;
  readonly projectKey: string;
  readonly snapshotVersion: string;
  readonly webAppOrigin: string;
  readonly configuration:
    | { readonly state: "not_configured" }
    | {
        readonly state: "invalid";
        readonly reason: "container" | "instrumentation";
      }
    | {
        readonly state: "configured";
        readonly container: { readonly id: string; readonly name: string };
      }
    | { readonly state: "selection_required" };
  readonly pendingThreadCount: number;
  readonly run: {
    readonly hasActiveRun: boolean;
    readonly hasEverSucceeded: boolean;
    readonly latest: {
      readonly completedAt: string | null;
      readonly status:
        | "queued"
        | "freezing"
        | "batching"
        | "reducing"
        | "finalizing"
        | "succeeded"
        | "failed";
    } | null;
  };
  readonly pendingCandidateCount: number;
  readonly skillsPage: InspectorLearningPage<InspectorLearningSkill>;
  readonly insightsPage: InspectorLearningPage<InspectorLearningInsight>;
  readonly links: {
    readonly learning: string;
    readonly candidates: string | null;
    readonly runs: string | null;
  };
}

export interface InspectorLearningRequestV1 {
  readonly agentId?: string;
  readonly skillsPage?: number;
  readonly insightsPage?: number;
}

type RecordValue = Record<string, unknown>;

const record = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const string = (value: unknown, maximum: number): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= maximum;
const integer = (value: unknown, minimum = 0): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
const date = (value: unknown): value is string =>
  typeof value === "string" && !Number.isNaN(Date.parse(value));

/**
 * Accepts only the configured Intelligence web-app origin.
 *
 * Learning links are server-authored actions. Treating every HTTPS origin as
 * trusted would let a misconfigured or compromised upstream turn Inspector
 * copy into a navigation primitive for an arbitrary site.
 */
export function parseInspectorLearningUrl(
  value: unknown,
  trustedOrigin: unknown,
): string | undefined {
  if (
    typeof value !== "string" ||
    value.length > 4_000 ||
    typeof trustedOrigin !== "string" ||
    trustedOrigin.length > 2_000
  ) {
    return undefined;
  }
  try {
    const parsed = new URL(value);
    const configured = new URL(trustedOrigin);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
      configured.hostname,
    );
    if (
      parsed.username ||
      parsed.password ||
      configured.username ||
      configured.password ||
      configured.pathname !== "/" ||
      configured.search ||
      configured.hash ||
      (configured.protocol !== "https:" &&
        !(configured.protocol === "http:" && loopback)) ||
      parsed.origin !== configured.origin
    ) {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function parseEvidence(value: unknown): InspectorLearningEvidence | undefined {
  if (record(value) && value.status === "unavailable") {
    return Object.keys(value).length === 1
      ? { status: "unavailable" }
      : undefined;
  }
  if (
    !record(value) ||
    value.status !== "available" ||
    !string(value.threadId, 128) ||
    !date(value.updatedAt)
  ) {
    return undefined;
  }
  if (
    value.threadName !== null &&
    !(typeof value.threadName === "string" && value.threadName.length <= 4_000)
  ) {
    return undefined;
  }
  if (
    !Array.isArray(value.messageIds) ||
    value.messageIds.length > 200 ||
    !value.messageIds.every((id) => string(id, 128))
  ) {
    return undefined;
  }
  return {
    status: "available",
    threadId: value.threadId,
    threadName: value.threadName,
    messageIds: [...value.messageIds],
    updatedAt: value.updatedAt,
  };
}

function parseInsight(value: unknown): InspectorLearningInsight | undefined {
  if (
    !record(value) ||
    !string(value.id, 128) ||
    !string(value.statement, 4_000) ||
    !string(value.impact, 4_000) ||
    !integer(value.totalThreadCount) ||
    typeof value.evidenceTruncated !== "boolean" ||
    !Array.isArray(value.evidence) ||
    value.evidence.length > 100
  ) {
    return undefined;
  }
  const evidence = value.evidence.map(parseEvidence);
  if (evidence.some((item) => item === undefined)) return undefined;
  return {
    id: value.id,
    statement: value.statement,
    impact: value.impact,
    totalThreadCount: value.totalThreadCount,
    evidenceTruncated: value.evidenceTruncated,
    evidence: evidence as InspectorLearningEvidence[],
  };
}

function parseSkill(value: unknown): InspectorLearningSkill | undefined {
  if (
    !record(value) ||
    !string(value.id, 128) ||
    !string(value.name, 128) ||
    !string(value.description, 4_000) ||
    !integer(value.revision, 1) ||
    typeof value.skillMd !== "string" ||
    value.skillMd.length > 131_072
  ) {
    return undefined;
  }
  const sourceInsight =
    value.sourceInsight === null ? null : parseInsight(value.sourceInsight);
  if (sourceInsight === undefined) return undefined;
  return {
    id: value.id,
    name: value.name,
    description: value.description,
    revision: value.revision,
    skillMd: value.skillMd,
    sourceInsight,
  };
}

function parsePage<T>(
  value: unknown,
  pageSize: 3 | 4,
  parseItem: (item: unknown) => T | undefined,
): InspectorLearningPage<T> | undefined {
  if (
    !record(value) ||
    !integer(value.page, 1) ||
    value.pageSize !== pageSize ||
    !integer(value.total) ||
    !integer(value.totalPages) ||
    !Array.isArray(value.items) ||
    value.items.length > pageSize
  ) {
    return undefined;
  }
  const items = value.items.map(parseItem);
  if (items.some((item) => item === undefined)) return undefined;
  if (value.total === 0) {
    if (value.page !== 1 || value.totalPages !== 0 || items.length !== 0) {
      return undefined;
    }
  } else {
    const totalPages = Math.ceil(value.total / pageSize);
    const expectedItems = Math.min(
      pageSize,
      value.total - (value.page - 1) * pageSize,
    );
    if (
      value.totalPages !== totalPages ||
      value.page > totalPages ||
      items.length !== expectedItems
    ) {
      return undefined;
    }
  }
  return {
    page: value.page,
    pageSize,
    total: value.total,
    totalPages: value.totalPages,
    items: items as T[],
  };
}

function parseConfiguration(
  value: unknown,
): InspectorLearningSnapshotV1["configuration"] | undefined {
  if (!record(value)) return undefined;
  if (
    value.state === "not_configured" ||
    value.state === "selection_required"
  ) {
    return { state: value.state };
  }
  if (
    value.state === "invalid" &&
    (value.reason === "container" || value.reason === "instrumentation")
  ) {
    return { state: value.state, reason: value.reason };
  }
  if (
    value.state === "configured" &&
    record(value.container) &&
    string(value.container.id, 128) &&
    string(value.container.name, 128)
  ) {
    return {
      state: "configured",
      container: { id: value.container.id, name: value.container.name },
    };
  }
  return undefined;
}

const runStatuses = new Set([
  "queued",
  "freezing",
  "batching",
  "reducing",
  "finalizing",
  "succeeded",
  "failed",
]);

/** Validates and copies an untrusted Learning snapshot at each process boundary. */
export function parseInspectorLearningSnapshotV1(
  value: unknown,
): InspectorLearningSnapshotV1 | undefined {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    !string(value.projectKey, 128) ||
    !string(value.snapshotVersion, 128) ||
    !integer(value.pendingThreadCount) ||
    !integer(value.pendingCandidateCount) ||
    !record(value.run) ||
    typeof value.run.hasActiveRun !== "boolean" ||
    typeof value.run.hasEverSucceeded !== "boolean"
  ) {
    return undefined;
  }
  const configuration = parseConfiguration(value.configuration);
  const skillsPage = parsePage(value.skillsPage, 3, parseSkill);
  const insightsPage = parsePage(value.insightsPage, 4, parseInsight);
  if (!configuration || !skillsPage || !insightsPage) return undefined;
  let latest: InspectorLearningSnapshotV1["run"]["latest"] = null;
  if (value.run.latest !== null) {
    const latestRun = value.run.latest;
    if (!record(latestRun)) {
      return undefined;
    }
    const { status, completedAt } = latestRun;
    if (
      typeof status !== "string" ||
      !runStatuses.has(status) ||
      (completedAt !== null && !date(completedAt))
    )
      return undefined;
    latest = {
      status: status as NonNullable<typeof latest>["status"],
      completedAt: completedAt as NonNullable<typeof latest>["completedAt"],
    };
  }
  if (!record(value.links)) return undefined;
  const originUrl = parseInspectorLearningUrl(
    value.webAppOrigin,
    value.webAppOrigin,
  );
  if (!originUrl || new URL(originUrl).pathname !== "/") return undefined;
  const webAppOrigin = new URL(originUrl).origin;
  const learning = parseInspectorLearningUrl(
    value.links.learning,
    webAppOrigin,
  );
  const candidates =
    value.links.candidates === null
      ? null
      : parseInspectorLearningUrl(value.links.candidates, webAppOrigin);
  const runs =
    value.links.runs === null
      ? null
      : parseInspectorLearningUrl(value.links.runs, webAppOrigin);
  if (
    !learning ||
    candidates === undefined ||
    runs === undefined ||
    (value.pendingThreadCount > 0 && runs === null) ||
    (value.pendingCandidateCount > 0 && candidates === null)
  )
    return undefined;
  return {
    schemaVersion: 1,
    projectKey: value.projectKey,
    snapshotVersion: value.snapshotVersion,
    webAppOrigin,
    configuration,
    pendingThreadCount: value.pendingThreadCount,
    run: {
      hasActiveRun: value.run.hasActiveRun,
      hasEverSucceeded: value.run.hasEverSucceeded,
      latest,
    },
    pendingCandidateCount: value.pendingCandidateCount,
    skillsPage,
    insightsPage,
    links: { learning, candidates, runs },
  };
}

/** Normalizes the browser-owned request without accepting container scope. */
export function parseInspectorLearningRequestV1(
  value: unknown,
): InspectorLearningRequestV1 | undefined {
  if (!record(value)) return undefined;
  if (
    Object.keys(value).some(
      (key) => !["agentId", "skillsPage", "insightsPage"].includes(key),
    )
  ) {
    return undefined;
  }
  const agentId = value.agentId;
  const skillsPage = value.skillsPage;
  const insightsPage = value.insightsPage;
  if (agentId !== undefined && !string(agentId, 128)) return undefined;
  if (skillsPage !== undefined && !integer(skillsPage, 1)) return undefined;
  if (insightsPage !== undefined && !integer(insightsPage, 1)) return undefined;
  return {
    ...(agentId === undefined ? {} : { agentId }),
    ...(skillsPage === undefined ? {} : { skillsPage }),
    ...(insightsPage === undefined ? {} : { insightsPage }),
  };
}
