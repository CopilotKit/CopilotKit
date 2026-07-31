/**
 * Inspector metadata supplied by a trusted CopilotKit runtime.
 *
 * Each optional module is independent so clients can render partial metadata
 * from runtimes that do not expose every module.
 */
export interface InspectorMetadataV1 {
  readonly schemaVersion: 1;
  readonly identity?: {
    readonly organizationName: string;
    readonly projectName: string;
  };
  readonly plan?: {
    readonly code: string;
    readonly label: string;
  };
  readonly license?: {
    readonly state: "valid" | "none" | "expired" | "unknown";
  };
  readonly action?:
    | { readonly kind: "manage_plan"; readonly url: string }
    | { readonly kind: "renew"; readonly url: string }
    | { readonly kind: "enable_intelligence"; readonly url: string };
  readonly usage?: {
    readonly used: number;
    readonly limit:
      | { readonly kind: "finite"; readonly value: number }
      | { readonly kind: "unlimited" }
      | { readonly kind: "unknown" };
    readonly expiringSoonCount: number;
  };
}

type UnknownRecord = Record<string, unknown>;
type InspectorIdentity = NonNullable<InspectorMetadataV1["identity"]>;
type InspectorPlan = NonNullable<InspectorMetadataV1["plan"]>;
type InspectorLicense = NonNullable<InspectorMetadataV1["license"]>;
type InspectorAction = NonNullable<InspectorMetadataV1["action"]>;
type InspectorUsage = NonNullable<InspectorMetadataV1["usage"]>;
type InspectorUsageLimit = InspectorUsage["limit"];

function isRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function parseNonBlankString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = value.trim();
  return parsed.length > 0 ? parsed : undefined;
}

function parseIdentity(value: unknown): InspectorIdentity | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const organizationName = parseNonBlankString(value.organizationName);
  const projectName = parseNonBlankString(value.projectName);
  if (organizationName === undefined || projectName === undefined) {
    return undefined;
  }

  return { organizationName, projectName };
}

function parsePlan(value: unknown): InspectorPlan | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const code = parseNonBlankString(value.code);
  const label = parseNonBlankString(value.label);
  if (code === undefined || label === undefined) {
    return undefined;
  }

  return { code, label };
}

function parseLicense(value: unknown): InspectorLicense | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  switch (value.state) {
    case "valid":
    case "none":
    case "expired":
    case "unknown":
      return { state: value.state };
    default:
      return undefined;
  }
}

function parseActionKind(value: unknown): InspectorAction["kind"] | undefined {
  switch (value) {
    case "manage_plan":
    case "renew":
    case "enable_intelligence":
      return value;
    default:
      return undefined;
  }
}

function parseSafeActionUrl(value: unknown): string | undefined {
  const url = parseNonBlankString(value);
  if (url === undefined || url.includes("?") || url.includes("#")) {
    return undefined;
  }

  const authorityStart = url.indexOf("://");
  if (authorityStart < 1) {
    return undefined;
  }

  const authorityAndPath = url.slice(authorityStart + 3);
  const pathStart = authorityAndPath.indexOf("/");
  const authority =
    pathStart === -1 ? authorityAndPath : authorityAndPath.slice(0, pathStart);
  if (authority.includes("@")) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }

  if (parsed.hostname.length === 0 || parsed.username || parsed.password) {
    return undefined;
  }

  if (parsed.protocol === "https:") {
    return url;
  }

  if (parsed.protocol === "http:" && parsed.hostname === "localhost") {
    return url;
  }

  return undefined;
}

function parseAction(value: unknown): InspectorAction | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const kind = parseActionKind(value.kind);
  const url = parseSafeActionUrl(value.url);
  if (kind === undefined || url === undefined) {
    return undefined;
  }

  return { kind, url };
}

function isFiniteNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseUsageLimit(value: unknown): InspectorUsageLimit | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (value.kind === "finite") {
    if (
      typeof value.value !== "number" ||
      !Number.isSafeInteger(value.value) ||
      value.value < 1
    ) {
      return undefined;
    }

    return { kind: "finite", value: value.value };
  }

  if (value.kind === "unlimited") {
    return { kind: "unlimited" };
  }

  if (value.kind === "unknown") {
    return { kind: "unknown" };
  }

  return undefined;
}

function parseUsage(value: unknown): InspectorUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const limit = parseUsageLimit(value.limit);
  if (
    !isFiniteNonnegativeInteger(value.used) ||
    limit === undefined ||
    !isFiniteNonnegativeInteger(value.expiringSoonCount)
  ) {
    return undefined;
  }

  return {
    used: value.used,
    limit,
    expiringSoonCount: value.expiringSoonCount,
  };
}

/**
 * Parses untrusted inspector metadata without letting one invalid optional
 * module hide the other valid modules.
 *
 * @param value - The decoded runtime response body.
 * @returns Normalized version 1 metadata, or `undefined` for an unsupported
 * top-level payload.
 */
export function parseInspectorMetadataV1(
  value: unknown,
): InspectorMetadataV1 | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    return undefined;
  }

  const identity = parseIdentity(value.identity);
  const plan = parsePlan(value.plan);
  const license = parseLicense(value.license);
  const action = parseAction(value.action);
  const usage = parseUsage(value.usage);

  return {
    schemaVersion: 1,
    ...(identity === undefined ? {} : { identity }),
    ...(plan === undefined ? {} : { plan }),
    ...(license === undefined ? {} : { license }),
    ...(action === undefined ? {} : { action }),
    ...(usage === undefined ? {} : { usage }),
  };
}
