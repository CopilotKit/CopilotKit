import { A2UI_VERSION } from "./types";
import type { GenerativeUIActionBinding, GenerativeUIManifest } from "./types";

export type OperationValidation = { ok: true } | { ok: false; reason: string };

const OPERATION_KINDS = [
  "createSurface",
  "updateComponents",
  "updateDataModel",
  "deleteSurface",
] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

export interface ValidateOperationOptions {
  manifest: Pick<GenerativeUIManifest, "catalogId" | "components">;
  /** Surfaces that exist before this operation is applied. */
  knownSurfaces: ReadonlySet<string>;
  /**
   * UI-callable functions. When provided, `functionCall` bindings must name
   * one of them. The client omits it: availability is checked at click time.
   */
  functions?: GenerativeUIManifest["functions"];
}

const OK: OperationValidation = { ok: true };
const fail = (reason: string): OperationValidation => ({ ok: false, reason });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads an own property only. Model-controlled keys such as "constructor" or
 * "toString" must not resolve to Object.prototype members.
 */
function ownValue<T>(
  record: Record<string, T> | undefined,
  key: string,
): T | undefined {
  return record && Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}

export function getOperationKind(op: unknown): OperationKind | undefined {
  if (!isRecord(op)) return undefined;
  const kinds = OPERATION_KINDS.filter((kind) => kind in op);
  return kinds.length === 1 ? kinds[0] : undefined;
}

export function getOperationSurfaceId(op: unknown): string | undefined {
  const kind = getOperationKind(op);
  if (!kind) return undefined;
  const payload = (op as Record<string, unknown>)[kind];
  return isRecord(payload) && typeof payload.surfaceId === "string"
    ? payload.surfaceId
    : undefined;
}

/** `{ "path": "/x" }` — a data-model binding. */
export function isPathBinding(value: unknown): value is { path: string } {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    Object.keys(value).length === 1
  );
}

export function isActionBinding(
  value: unknown,
): value is GenerativeUIActionBinding {
  return (
    isRecord(value) &&
    Object.keys(value).length === 1 &&
    (isRecord(value.functionCall) || isRecord(value.event))
  );
}

export function validateOperation(
  op: unknown,
  options: ValidateOperationOptions,
): OperationValidation {
  if (!isRecord(op)) return fail("operation must be a JSON object");
  if (op.version !== A2UI_VERSION) {
    return fail(`operation version must be "${A2UI_VERSION}"`);
  }
  const kind = getOperationKind(op);
  if (!kind) {
    return fail(
      `operation must contain exactly one of ${OPERATION_KINDS.join(", ")}`,
    );
  }
  const payload = op[kind];
  if (
    !isRecord(payload) ||
    typeof payload.surfaceId !== "string" ||
    !payload.surfaceId
  ) {
    return fail(`${kind}.surfaceId is required`);
  }
  const surfaceId = payload.surfaceId;
  const known = options.knownSurfaces.has(surfaceId);

  if (kind === "createSurface") {
    if (known) return fail(`surface "${surfaceId}" already exists`);
    if (payload.catalogId !== options.manifest.catalogId) {
      return fail(
        `unknown catalog "${String(payload.catalogId)}"; use "${options.manifest.catalogId}"`,
      );
    }
    return OK;
  }
  if (!known) {
    return fail(
      `surface "${surfaceId}" does not exist; send createSurface first`,
    );
  }
  if (kind === "deleteSurface") return OK;
  if (kind === "updateDataModel") return validateDataModelUpdate(payload);
  return validateComponents(payload.components, options);
}

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

function decodeSegment(segment: string): string {
  return segment.replace(/~([01])/g, (_, g) => (g === "1" ? "/" : "~"));
}

function validateDataModelUpdate(
  payload: Record<string, unknown>,
): OperationValidation {
  const path = payload.path ?? "/";
  if (typeof path !== "string" || !path.startsWith("/")) {
    return fail("updateDataModel.path must be an absolute JSON pointer");
  }
  if (path === "/") {
    // Paths such as "/items" point into the root, so the root must be an object.
    if (!isRecord(payload.value)) {
      return fail("a root updateDataModel value must be a JSON object");
    }
    return OK;
  }
  const reason = pathProblem(path, "updateDataModel.path");
  return reason ? fail(reason) : OK;
}

/**
 * Checks the segments of an absolute JSON pointer ("/a/b") or of a path
 * relative to a template item ("a/b"). `label` names the field in the reason.
 */
function pathProblem(path: string, label: string): string | undefined {
  const relative = path.startsWith("/") ? path.slice(1) : path;
  const segments = relative.split("/");
  if (segments.some((segment) => segment === "")) {
    return `${label} must not contain empty segments`;
  }
  const decoded = segments.map(decodeSegment);
  const forbidden = decoded.find((segment) => FORBIDDEN_SEGMENTS.has(segment));
  if (forbidden !== undefined) {
    return `path segment "${forbidden}" is not allowed in ${label}`;
  }
  return undefined;
}

function validateComponents(
  components: unknown,
  options: ValidateOperationOptions,
): OperationValidation {
  if (!Array.isArray(components) || components.length === 0) {
    return fail("updateComponents.components must be a non-empty array");
  }
  const ids = new Set<string>();
  for (const node of components) {
    const reason = validateNode(node, options);
    if (reason) {
      return fail(
        isRecord(node) && typeof node.id === "string"
          ? `component "${node.id}": ${reason}`
          : reason,
      );
    }
    const id = (node as { id: string }).id;
    if (ids.has(id))
      return fail(`component "${id}" appears twice in one update`);
    ids.add(id);
  }
  return OK;
}

function validateNode(
  node: unknown,
  options: ValidateOperationOptions,
): string | undefined {
  if (!isRecord(node)) return "component must be a JSON object";
  if (typeof node.id !== "string" || !node.id) return "id is required";
  if (typeof node.component !== "string") return "component type is required";
  const entry = ownValue(options.manifest.components, node.component);
  if (!entry) return `unknown component "${node.component}"`;
  const propNames = Object.keys(
    (entry.props.properties as Record<string, unknown> | undefined) ?? {},
  );
  for (const [key, value] of Object.entries(node)) {
    if (key === "id" || key === "component") continue;
    if (ownValue(entry.events, key)) {
      const reason = validateActionBinding(value, options.functions);
      if (reason) return `${key}: ${reason}`;
      continue;
    }
    const slot = ownValue(entry.slots, key);
    if (slot) {
      const reason = validateSlot(value, slot, node.id);
      if (reason) return `${key}: ${reason}`;
      continue;
    }
    if (!propNames.includes(key)) return `unknown prop "${key}"`;
    if (containsFunctionCall(value)) {
      return `${key}: function calls are only allowed in event props`;
    }
  }
  const required = (entry.props.required as string[] | undefined) ?? [];
  for (const name of required) {
    if (!(name in node)) return `missing required prop "${name}"`;
  }
  return undefined;
}

function validateActionBinding(
  value: unknown,
  functions: GenerativeUIManifest["functions"] | undefined,
): string | undefined {
  if (!isRecord(value)) return "must be an action object";
  const keys = Object.keys(value);
  if (
    keys.length !== 1 ||
    (keys[0] !== "functionCall" && keys[0] !== "event")
  ) {
    return 'must be { "functionCall": ... } or { "event": ... }';
  }
  if (keys[0] === "functionCall") {
    const call = value.functionCall;
    if (!isRecord(call) || typeof call.call !== "string" || !call.call) {
      return "functionCall.call must be a function name";
    }
    if (call.args !== undefined && !isRecord(call.args)) {
      return "functionCall.args must be an object";
    }
    if (
      functions &&
      !Object.prototype.hasOwnProperty.call(functions, call.call)
    ) {
      return `function "${call.call}" is not exposed to generative UI`;
    }
    return undefined;
  }
  const event = value.event;
  if (!isRecord(event) || typeof event.name !== "string" || !event.name) {
    return "event.name is required";
  }
  if (event.context !== undefined && !isRecord(event.context)) {
    return "event.context must be an object";
  }
  return undefined;
}

function validateSlot(
  value: unknown,
  kind: "single" | "multiple",
  ownId: string,
): string | undefined {
  const isTemplate = isRecord(value) && "componentId" in value;
  if (kind === "single" && isTemplate) {
    return 'a template { "componentId", "path" } is only allowed in a "multiple" slot';
  }
  if (kind === "multiple" && isTemplate) {
    return validateTemplate(value, ownId);
  }
  if (kind === "multiple" && !Array.isArray(value)) {
    return 'must be an array of component ids or a template { "componentId", "path" }';
  }
  const ids = kind === "multiple" && Array.isArray(value) ? value : [value];
  for (const id of ids) {
    if (typeof id !== "string" || !id)
      return "must reference component ids (strings)";
    if (id === ownId) return "a component cannot be its own child";
  }
  return undefined;
}

function validateTemplate(
  template: Record<string, unknown>,
  ownId: string,
): string | undefined {
  const hasOnlyTemplateKeys = Object.keys(template).every(
    (key) => key === "componentId" || key === "path",
  );
  if (!hasOnlyTemplateKeys) {
    return 'a template takes only "componentId" and "path"';
  }
  const { componentId, path } = template;
  if (typeof componentId !== "string" || !componentId) {
    return "template componentId must be a component id";
  }
  if (componentId === ownId) return "a component cannot be its own child";
  if (typeof path !== "string" || !path) {
    return "template path must be a JSON pointer or a relative path";
  }
  return pathProblem(path, "template path");
}

function containsFunctionCall(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsFunctionCall);
  if (!isRecord(value)) return false;
  if (typeof value.call === "string" || "functionCall" in value) return true;
  return Object.values(value).some(containsFunctionCall);
}
