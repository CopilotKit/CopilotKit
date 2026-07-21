export interface FeatureDefinition {
  id: string;
  kind?: string;
  deprecated?: boolean;
}

export type FrontendSupportState =
  | "supported"
  | "docs-only"
  | "not-supported"
  | "not-applicable"
  | "quarantined";

export interface FrontendDefinition {
  id: string;
  name: string;
  icon: string;
  summary: string;
  runnable: boolean;
  feature_support_required: boolean;
}

export interface FrontendSupportDeclaration {
  state: FrontendSupportState;
  reason?: string;
  owner?: string;
  review_date?: string;
  issue?: string;
}

export interface FrontendRegistry {
  version: string;
  default_frontend: string;
  frontends: FrontendDefinition[];
  feature_support: Record<string, Record<string, FrontendSupportDeclaration>>;
}

const SUPPORT_STATES = new Set<FrontendSupportState>([
  "supported",
  "docs-only",
  "not-supported",
  "not-applicable",
  "quarantined",
]);

const PERMANENT_EXCEPTION_STATES = new Set<FrontendSupportState>([
  "not-supported",
  "not-applicable",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(
  value: unknown,
  context: string,
  field: string,
): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${context} requires ${field}`);
  }
}

function validateReviewDate(value: unknown, context: string): void {
  requireNonEmptyString(value, context, "review_date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${context} review_date must use YYYY-MM-DD`);
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${context} review_date must be a real calendar date`);
  }
}

function validateFrontend(raw: unknown, index: number): FrontendDefinition {
  const context = `frontend at index ${index}`;
  if (!isRecord(raw)) {
    throw new Error(`${context} must be an object`);
  }

  requireNonEmptyString(raw.id, context, "id");
  requireNonEmptyString(raw.name, context, "name");
  requireNonEmptyString(raw.icon, context, "icon");
  requireNonEmptyString(raw.summary, context, "summary");
  if (typeof raw.runnable !== "boolean") {
    throw new Error(`${context} requires boolean runnable`);
  }
  if (typeof raw.feature_support_required !== "boolean") {
    throw new Error(`${context} requires boolean feature_support_required`);
  }
  if (raw.feature_support_required && !raw.runnable) {
    throw new Error(
      `${context} cannot require feature support when runnable is false`,
    );
  }

  return raw as unknown as FrontendDefinition;
}

function validateSupportDeclaration(
  raw: unknown,
  feature: FeatureDefinition,
  frontend: FrontendDefinition,
): FrontendSupportDeclaration {
  const prefix = `feature "${feature.id}" frontend "${frontend.id}"`;
  if (!isRecord(raw)) {
    throw new Error(`${prefix} support declaration must be an object`);
  }
  if (
    typeof raw.state !== "string" ||
    !SUPPORT_STATES.has(raw.state as FrontendSupportState)
  ) {
    throw new Error(
      `${prefix} has unknown support state ${JSON.stringify(raw.state)}`,
    );
  }

  const state = raw.state as FrontendSupportState;
  const context = `${prefix} state "${state}"`;
  if (feature.kind === "docs-only" && state !== "docs-only") {
    throw new Error(
      `docs-only feature "${feature.id}" must be docs-only for "${frontend.id}"`,
    );
  }
  if (feature.kind !== "docs-only" && state === "docs-only") {
    throw new Error(
      `runnable feature "${feature.id}" cannot be docs-only for "${frontend.id}"`,
    );
  }
  if (!frontend.runnable && state === "supported") {
    throw new Error(`${context} contradicts runnable=false`);
  }

  if (PERMANENT_EXCEPTION_STATES.has(state) || state === "quarantined") {
    requireNonEmptyString(raw.reason, context, "reason");
    requireNonEmptyString(raw.owner, context, "owner");
    validateReviewDate(raw.review_date, context);
  }
  if (state === "quarantined") {
    requireNonEmptyString(raw.issue, context, "issue");
  }

  return raw as unknown as FrontendSupportDeclaration;
}

/**
 * Validate and normalize the Showcase frontend registry against the active
 * feature taxonomy. The returned value is safe for generated registry data.
 */
export function normalizeFrontendRegistry(
  rawRegistry: unknown,
  features: readonly FeatureDefinition[],
): FrontendRegistry {
  if (!isRecord(rawRegistry)) {
    throw new Error("frontend registry must be an object");
  }
  requireNonEmptyString(rawRegistry.version, "frontend registry", "version");
  requireNonEmptyString(
    rawRegistry.default_frontend,
    "frontend registry",
    "default_frontend",
  );
  if (
    !Array.isArray(rawRegistry.frontends) ||
    rawRegistry.frontends.length === 0
  ) {
    throw new Error("frontend registry requires at least one frontend");
  }
  if (!isRecord(rawRegistry.feature_support)) {
    throw new Error("frontend registry requires feature_support");
  }

  const frontends = rawRegistry.frontends.map(validateFrontend);
  const frontendsById = new Map<string, FrontendDefinition>();
  for (const frontend of frontends) {
    if (frontendsById.has(frontend.id)) {
      throw new Error(`duplicate frontend id "${frontend.id}"`);
    }
    frontendsById.set(frontend.id, frontend);
  }
  if (!frontendsById.has(rawRegistry.default_frontend)) {
    throw new Error(
      `default frontend "${rawRegistry.default_frontend}" is not registered`,
    );
  }
  for (const requiredFrontendId of ["react", "angular"]) {
    const frontend = frontendsById.get(requiredFrontendId);
    if (frontend === undefined || !frontend.feature_support_required) {
      throw new Error(
        `required frontend "${requiredFrontendId}" is not registered`,
      );
    }
  }

  const activeFeatures = features.filter((feature) => !feature.deprecated);
  const activeFeaturesById = new Map(
    activeFeatures.map((feature) => [feature.id, feature]),
  );
  for (const featureId of Object.keys(rawRegistry.feature_support)) {
    if (!activeFeaturesById.has(featureId)) {
      throw new Error(`unknown or deprecated feature "${featureId}"`);
    }
  }

  const requiredFrontends = frontends.filter(
    (frontend) => frontend.feature_support_required,
  );
  const normalizedSupport: FrontendRegistry["feature_support"] = {};
  for (const feature of activeFeatures) {
    const rawFeatureSupport = rawRegistry.feature_support[feature.id];
    if (!isRecord(rawFeatureSupport)) {
      throw new Error(
        `active feature "${feature.id}" is missing frontend support`,
      );
    }

    for (const frontendId of Object.keys(rawFeatureSupport)) {
      if (!frontendsById.has(frontendId)) {
        throw new Error(
          `feature "${feature.id}" references unknown frontend "${frontendId}"`,
        );
      }
    }

    const declarations: Record<string, FrontendSupportDeclaration> = {};
    for (const frontend of requiredFrontends) {
      if (!(frontend.id in rawFeatureSupport)) {
        throw new Error(
          `feature "${feature.id}" is missing required frontend "${frontend.id}"`,
        );
      }
      declarations[frontend.id] = validateSupportDeclaration(
        rawFeatureSupport[frontend.id],
        feature,
        frontend,
      );
    }

    for (const [frontendId, rawDeclaration] of Object.entries(
      rawFeatureSupport,
    )) {
      if (frontendId in declarations) continue;
      declarations[frontendId] = validateSupportDeclaration(
        rawDeclaration,
        feature,
        frontendsById.get(frontendId)!,
      );
    }
    normalizedSupport[feature.id] = declarations;
  }

  return {
    version: rawRegistry.version,
    default_frontend: rawRegistry.default_frontend,
    frontends,
    feature_support: normalizedSupport,
  };
}
