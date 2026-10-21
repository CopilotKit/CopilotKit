import {
  GENERATIVE_UI_FUNCTIONS,
  functionCallers,
  isA2UIBasicFunction,
  isA2UIValueFunction,
  isCallBinding,
} from "./basic-functions";
import type { A2UIFunctionPermissions } from "./basic-functions";
import { collectChildRefs } from "./child-refs";
import type { ChildRef } from "./child-refs";
import {
  A2UI_VERSION,
  GENERATIVE_UI_AGENT_FUNCTION_CALLS,
  GENERATIVE_UI_AGENT_FUNCTION_CALLS_OFF_REASON,
} from "./types";
import type {
  GenerativeUIActionBinding,
  GenerativeUIJSONSchema,
  GenerativeUIManifest,
} from "./types";

export type OperationValidation = { ok: true } | { ok: false; reason: string };

const OPERATION_KINDS = [
  "createSurface",
  "updateComponents",
  "updateDataModel",
  "deleteSurface",
  "callRendererFunction",
] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

export interface ValidateOperationOptions {
  manifest: Pick<GenerativeUIManifest, "catalogId" | "components">;
  /**
   * Surfaces that exist before this operation is applied. `updateComponents`,
   * `updateDataModel`, and `deleteSurface` need their surface in this set.
   */
  knownSurfaces: ReadonlySet<string>;
  /**
   * Surface ids that were created before, also the deleted ones. A surface id
   * is unique for the life of the page, so `createSurface` rejects them.
   */
  createdSurfaces?: ReadonlySet<string>;
  /**
   * UI-callable functions. When provided, `functionCall` bindings and
   * `callRendererFunction` must name one of them. The client omits it:
   * availability is checked when the function runs.
   */
  functions?: GenerativeUIManifest["functions"];
  /**
   * The components that the target of the surface takes. When provided,
   * `updateComponents` and the inline components of `createSurface` can use
   * only these names. Left out, every catalog component is allowed.
   */
  allowedComponents?: AllowedComponents;
}

/** The component names that one target takes. */
export interface AllowedComponents {
  /** The target id, for the reason of a rejection. */
  target: string;
  names: ReadonlySet<string>;
}

const OK: OperationValidation = { ok: true };
const fail = (reason: string): OperationValidation => ({ ok: false, reason });

/** Models write the v0.9 binding from habit. The reason names the v1.0 form. */
const V09_PATH_REASON = 'bind data with {"@path": "/x"}, not {"path": "/x"}';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: object, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * Reads an own property only. Model-controlled keys such as "constructor" or
 * "toString" must not resolve to Object.prototype members.
 */
function ownValue<T>(record: Record<string, T> | undefined, key: string) {
  return record && hasOwn(record, key) ? record[key] : undefined;
}

export function getOperationKind(op: unknown) {
  if (!isRecord(op)) return undefined;
  const kinds = OPERATION_KINDS.filter((kind) => kind in op);
  return kinds.length === 1 ? kinds[0] : undefined;
}

/** The `surfaceId` of a surface operation. `callRendererFunction` has none. */
export function getOperationSurfaceId(op: unknown) {
  if (!isRecord(op)) return undefined;
  const kind = getOperationKind(op);
  if (!kind) return undefined;
  const payload = op[kind];
  return isRecord(payload) && typeof payload.surfaceId === "string"
    ? payload.surfaceId
    : undefined;
}

/** `{ "@path": "/x" }`: a data-model binding. */
export function isPathBinding(value: unknown): value is { "@path": string } {
  return (
    isRecord(value) &&
    typeof value["@path"] === "string" &&
    Object.keys(value).length === 1
  );
}

/** `{ "path": "/x" }`: the v0.9 binding, which v1.0 does not accept. */
function isV09PathBinding(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    Object.keys(value).length === 1
  );
}

/**
 * `{ "@call": "@index" }` or `{ "@call": "@index", "args": { "offset": 1 } }`:
 * the 0-based position of the item in a template, plus `offset`.
 */
export function isIndexCall(
  value: unknown,
): value is { "@call": "@index"; args?: { offset?: number } } {
  if (!isRecord(value) || value["@call"] !== "@index") return false;
  const hasOnlyCallKeys = Object.keys(value).every(
    (key) => key === "@call" || key === "args",
  );
  if (!hasOnlyCallKeys) return false;
  const { args } = value;
  if (args === undefined) return true;
  return (
    isRecord(args) &&
    Object.keys(args).every((key) => key === "offset") &&
    (args.offset === undefined || Number.isFinite(args.offset))
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

/**
 * Checks one A2UI v1.0 operation against the catalog and the surfaces that
 * exist. The operation comes from the model, so nothing in it is trusted.
 *
 * @param op - The operation, as parsed from JSON.
 * @param options - The catalog, the known and created surfaces, the
 *   functions that the UI can call, and the components that the target of
 *   the surface takes.
 *
 * @example
 * ```ts
 * const result = validateOperation(op, { manifest, knownSurfaces });
 * if (!result.ok) rejected.push({ index, reason: result.reason });
 * ```
 */
export function validateOperation(
  op: unknown,
  options: ValidateOperationOptions,
) {
  if (!isRecord(op)) return fail("operation must be a JSON object");
  if (op.version !== A2UI_VERSION) return fail(versionProblem(op.version));
  const kind = getOperationKind(op);
  if (!kind) {
    return fail(
      `operation must contain exactly one of ${OPERATION_KINDS.join(", ")}`,
    );
  }
  const payload = op[kind];
  if (kind === "callRendererFunction") {
    if (!GENERATIVE_UI_AGENT_FUNCTION_CALLS) {
      return fail(GENERATIVE_UI_AGENT_FUNCTION_CALLS_OFF_REASON);
    }
    return validateRendererFunctionCall(payload, options);
  }
  if (
    !isRecord(payload) ||
    typeof payload.surfaceId !== "string" ||
    !payload.surfaceId
  ) {
    return fail(`${kind}.surfaceId is required`);
  }
  const surfaceId = payload.surfaceId;
  if (kind === "createSurface") {
    return validateCreateSurface(payload, surfaceId, options);
  }
  if (!options.knownSurfaces.has(surfaceId)) {
    return fail(
      `surface "${surfaceId}" does not exist; send createSurface first`,
    );
  }
  switch (kind) {
    case "deleteSurface":
      return OK;
    case "updateDataModel":
      return validateDataModelUpdate(payload);
    case "updateComponents":
      return validateComponents(
        payload.components,
        "updateComponents.components",
        options,
      );
  }
}

function versionProblem(version: unknown) {
  return typeof version === "string"
    ? `unsupported version "${version}"; use "${A2UI_VERSION}"`
    : `operation needs "version":"${A2UI_VERSION}"`;
}

function catalogProblem(catalogId: unknown, expected: string) {
  if (catalogId === undefined || catalogId === expected) return undefined;
  return `unknown catalog "${String(catalogId)}"; leave out catalogId or use "${expected}"`;
}

function validateCreateSurface(
  payload: Record<string, unknown>,
  surfaceId: string,
  options: ValidateOperationOptions,
) {
  if (options.knownSurfaces.has(surfaceId)) {
    return fail(`surface "${surfaceId}" already exists`);
  }
  if (options.createdSurfaces?.has(surfaceId)) {
    return fail(
      `surface id "${surfaceId}" was used before; use a new surfaceId`,
    );
  }
  const catalogReason = catalogProblem(
    payload.catalogId,
    options.manifest.catalogId,
  );
  if (catalogReason) return fail(catalogReason);
  const { dataModel, components } = payload;
  if (dataModel !== undefined && !isRecord(dataModel)) {
    return fail("createSurface.dataModel must be a JSON object");
  }
  if (components === undefined) return OK;
  return validateComponents(components, "createSurface.components", options);
}

function validateRendererFunctionCall(
  payload: unknown,
  options: ValidateOperationOptions,
) {
  const hasCallId =
    isRecord(payload) &&
    typeof payload.functionCallId === "string" &&
    payload.functionCallId !== "";
  if (!hasCallId) {
    return fail(
      "callRendererFunction.functionCallId must be a non-empty string",
    );
  }
  const reason = functionCallProblem(
    payload.callFunction,
    "callRendererFunction.callFunction",
    options,
  );
  return reason ? fail(reason) : OK;
}

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

function decodeSegment(segment: string) {
  return segment.replace(/~([01])/g, (_, g) => (g === "1" ? "/" : "~"));
}

function validateDataModelUpdate(payload: Record<string, unknown>) {
  if (payload.value === undefined) {
    return fail(
      'updateDataModel.value is required; use "value":null to delete',
    );
  }
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
function pathProblem(path: string, label: string) {
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
  label: string,
  options: ValidateOperationOptions,
) {
  if (!Array.isArray(components) || components.length === 0) {
    return fail(`${label} must be a non-empty array`);
  }
  const ids = new Set<string>();
  for (const node of components) {
    if (!isRecord(node)) return fail("component must be a JSON object");
    const { id } = node;
    if (typeof id !== "string" || !id) return fail("id is required");
    const reason = nodeProblem(node, id, options);
    if (reason) return fail(`component "${id}": ${reason}`);
    if (ids.has(id)) {
      return fail(`component "${id}" appears twice in one update`);
    }
    ids.add(id);
  }
  return OK;
}

function nodeProblem(
  node: Record<string, unknown>,
  id: string,
  options: ValidateOperationOptions,
) {
  if (typeof node.component !== "string") return "component type is required";
  const entry = ownValue(options.manifest.components, node.component);
  if (!entry) return `unknown component "${node.component}"`;
  const { allowedComponents } = options;
  if (allowedComponents && !allowedComponents.names.has(node.component)) {
    const names = [...allowedComponents.names].join(", ") || "none";
    return `"${node.component}" is not allowed in target "${allowedComponents.target}"; use one of: ${names}`;
  }
  const { properties, required } = entry.props;
  const propNames = isRecord(properties) ? Object.keys(properties) : [];
  const props = Object.entries(node);
  for (const [key, value] of props) {
    if (key === "id" || key === "component") continue;
    if (key === "catalogId") {
      const reason = catalogProblem(value, options.manifest.catalogId);
      if (reason) return `${key}: ${reason}`;
      continue;
    }
    if (key === "metadata") {
      const isMetadata =
        isRecord(value) &&
        (value.extensions === undefined || isRecord(value.extensions));
      if (!isMetadata) return 'metadata must be { "extensions": { ... } }';
      continue;
    }
    if (key === "accessibility") {
      const reason = accessibilityProblem(value);
      if (reason) return `${key}: ${reason}`;
      continue;
    }
    if (ownValue(entry.events, key)) {
      const reason = actionBindingProblem(value, options);
      if (reason) return `${key}: ${reason}`;
      continue;
    }
    const slot = ownValue(entry.slots, key);
    if (slot) {
      const reason = slotProblem(value, slot, id);
      if (reason) return `${key}: ${reason}`;
      continue;
    }
    if (!propNames.includes(key)) return `unknown prop "${key}"`;
    if (isV09PathBinding(value)) return `${key}: ${V09_PATH_REASON}`;
    const call = findForbiddenCall(value, { allowValueFunctions: true });
    if (call !== undefined) {
      return `${key}: ${call}; a data prop can call only ${VALUE_FUNCTION_LIST}`;
    }
  }
  for (const ref of childRefsOf(entry.props)) {
    const reason = childRefProblem(node, ref, id);
    if (reason) return reason;
  }
  const requiredNames = Array.isArray(required) ? required : [];
  for (const name of requiredNames) {
    if (typeof name === "string" && !(name in node)) {
      return `missing required prop "${name}"`;
    }
  }
  return undefined;
}

const ACCESSIBILITY_KEYS = ["label", "description", "live", "hidden"];
const LIVE_VALUES = ["off", "polite", "assertive"];

/**
 * Checks the `accessibility` of a component envelope: `label` and
 * `description` are strings or dynamic values, `live` is one of the ARIA
 * values, `hidden` is a boolean or a dynamic value.
 */
function accessibilityProblem(value: unknown) {
  if (!isRecord(value)) {
    return 'must be { "label": "...", "description": "...", "live": "polite", "hidden": false }';
  }
  const isDynamic = (field: unknown) =>
    isPathBinding(field) || isCallBinding(field);
  for (const [key, field] of Object.entries(value)) {
    if (!ACCESSIBILITY_KEYS.includes(key)) return `unknown key "${key}"`;
    if (isV09PathBinding(field)) return `${key}: ${V09_PATH_REASON}`;
    if (isDynamic(field)) {
      const call = findForbiddenCall(field, { allowValueFunctions: true });
      if (call !== undefined) return `${key}: ${call}`;
      continue;
    }
    if (key === "live") {
      if (typeof field !== "string" || !LIVE_VALUES.includes(field)) {
        return `live must be one of ${LIVE_VALUES.join(", ")}`;
      }
    } else if (key === "hidden") {
      if (typeof field !== "boolean") return "hidden must be a boolean";
    } else if (typeof field !== "string") {
      return `${key} must be a string`;
    }
  }
  return undefined;
}

function actionBindingProblem(
  value: unknown,
  options: ValidateOperationOptions,
) {
  if (!isRecord(value)) return "must be an action object";
  const keys = Object.keys(value);
  const isOneAction =
    keys.length === 1 && (keys[0] === "functionCall" || keys[0] === "event");
  if (!isOneAction) {
    return 'must be { "event": ... } or { "functionCall": ... }';
  }
  if (keys[0] === "functionCall") {
    return functionCallProblem(value.functionCall, "functionCall", options);
  }
  return eventProblem(value.event);
}

/**
 * Checks `{ "@call": "<function>", "args": { ... } }`. `label` names the
 * field in the reason.
 */
function functionCallProblem(
  call: unknown,
  label: string,
  options: ValidateOperationOptions,
) {
  if (!isRecord(call)) {
    return `${label} must be { "@call": "<function>", "args": { ... } }`;
  }
  const name = call["@call"];
  if (typeof name !== "string" || !name) {
    return typeof call.call === "string"
      ? `${label} names the function with "@call", not "call"`
      : `${label}["@call"] must be a function name`;
  }
  const { args } = call;
  if (args !== undefined && !isRecord(args)) {
    return `${label}.args must be an object`;
  }
  const catalogReason = catalogProblem(
    call.catalogId,
    options.manifest.catalogId,
  );
  if (catalogReason) return `${label}: ${catalogReason}`;
  const argEntries = Object.entries(args ?? {});
  for (const [key, arg] of argEntries) {
    if (isV09PathBinding(arg))
      return `${label}.args.${key}: ${V09_PATH_REASON}`;
  }
  // A function the app declares under a built-in name is the app's; the
  // restrictions of the built-in do not apply to it.
  const appFunctions = options.functions;
  const declared =
    appFunctions !== undefined && hasOwn(appFunctions, name)
      ? appFunctions[name]
      : undefined;
  const builtIn =
    declared === undefined && hasOwn(GENERATIVE_UI_FUNCTIONS, name)
      ? GENERATIVE_UI_FUNCTIONS[name]
      : undefined;
  if (declared === undefined && builtIn === undefined) {
    return appFunctions === undefined
      ? undefined
      : `function "${name}" is not exposed to generative UI`;
  }
  // Without the list of app functions, a built-in name may be the app's own
  // function, so the dispatcher applies the restriction when the call runs.
  if (declared === undefined && appFunctions === undefined) return undefined;
  return callerProblem(
    name,
    declared ?? builtIn!,
    label.startsWith("callRendererFunction") ? "agent" : "renderer",
  );
}

/**
 * Why `caller` may not call a function with these permissions, or
 * `undefined` when it may. The dispatcher gives the same reasons at run
 * time, for the calls that are not validated against a function list.
 */
export function callerProblem(
  name: string,
  fn: A2UIFunctionPermissions,
  caller: "agent" | "renderer",
) {
  const callers = functionCallers(fn);
  if (caller === "agent" && !callers.agent) {
    return fn.requiresUserActivation
      ? `function "${name}" runs only from a user gesture; the agent cannot call it`
      : `function "${name}" runs only in the UI (allowedCallers "rendererOnly"); the agent cannot call it`;
  }
  if (caller === "renderer" && !callers.renderer) {
    return `function "${name}" runs only for the agent (allowedCallers "agentOnly"); the UI cannot call it`;
  }
  return undefined;
}

function eventProblem(event: unknown) {
  if (!isRecord(event) || typeof event.name !== "string" || !event.name) {
    return "event.name is required";
  }
  const { userMessage, context } = event;
  const isUserMessage =
    userMessage === undefined ||
    typeof userMessage === "string" ||
    isPathBinding(userMessage) ||
    (isRecord(userMessage) &&
      typeof userMessage["@call"] === "string" &&
      findForbiddenCall(userMessage, { allowValueFunctions: true }) ===
        undefined);
  if (!isUserMessage) {
    return isV09PathBinding(userMessage)
      ? `event.userMessage: ${V09_PATH_REASON}`
      : 'event.userMessage must be a string, {"@path": "/x"} or a function value';
  }
  if (context === undefined) return undefined;
  if (!isRecord(context)) return "event.context must be an object";
  const entries = Object.entries(context);
  for (const [key, entry] of entries) {
    if (isV09PathBinding(entry)) {
      return `event.context.${key}: ${V09_PATH_REASON}`;
    }
    const call = findForbiddenCall(entry, { allowValueFunctions: true });
    if (call !== undefined) {
      return `event.context.${key}: ${call}; a context value can call only ${VALUE_FUNCTION_LIST}`;
    }
  }
  return undefined;
}

function slotProblem(
  value: unknown,
  kind: "single" | "multiple",
  ownId: string,
) {
  const isTemplate = isRecord(value) && "componentId" in value;
  if (kind === "single" && isTemplate) {
    return 'a template { "componentId", "path" } is only allowed in a "multiple" slot';
  }
  if (kind === "multiple" && isTemplate) {
    return templateProblem(value, ownId);
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

function templateProblem(template: Record<string, unknown>, ownId: string) {
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

const VALUE_FUNCTION_LIST = `@index and the built-in functions (${Object.keys(
  GENERATIVE_UI_FUNCTIONS,
)
  .filter(isA2UIValueFunction)
  .join(", ")})`;

/**
 * The reason for the first function call in `value` that a data value may
 * not make, at any depth, or `undefined`. A data value may call `@index`
 * and, with `allowValueFunctions`, the basic functions that need no user
 * gesture; the renderer resolves those. An app function, `openUrl`, or an
 * event binding is not a value.
 */
// The annotation is needed: the function calls itself in its return.
function findForbiddenCall(
  value: unknown,
  options: { allowValueFunctions: boolean },
): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const reason = findForbiddenCall(item, options);
      if (reason !== undefined) return reason;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  if (isIndexCall(value)) return undefined;
  if (value["@call"] === "@index") return "@index takes only an offset";
  if (typeof value.call === "string") {
    return 'name the function with "@call", not "call"';
  }
  if ("functionCall" in value) {
    return "an event binding is not a value";
  }
  const name = value["@call"];
  if (typeof name === "string") {
    if (!options.allowValueFunctions || !isA2UIValueFunction(name)) {
      return isA2UIBasicFunction(name)
        ? `"${name}" runs only from an event`
        : `"${name}" is not a basic function`;
    }
    const args = value.args;
    if (args !== undefined && !isRecord(args)) {
      return `the args of "${name}" must be an object`;
    }
    return args === undefined ? undefined : findForbiddenCall(args, options);
  }
  for (const item of Object.values(value)) {
    const reason = findForbiddenCall(item, options);
    if (reason !== undefined) return reason;
  }
  return undefined;
}

const childRefCache = new WeakMap<GenerativeUIJSONSchema, ChildRef[]>();

/** The component references of a props schema, computed once per schema. */
function childRefsOf(props: GenerativeUIJSONSchema) {
  let refs = childRefCache.get(props);
  if (!refs) {
    refs = collectChildRefs(props);
    childRefCache.set(props, refs);
  }
  return refs;
}

/**
 * Checks the component ids at one reference of a node: a typed `child()`
 * or `childList()` prop, at any depth. A missing key is fine; the props
 * schema reports a required one.
 */
function childRefProblem(
  node: Record<string, unknown>,
  ref: ChildRef,
  ownId: string,
): string | undefined {
  const label = ref.path.filter((step) => step !== "*").join(".");
  const isDynamic = (value: unknown) =>
    isPathBinding(value) || (isRecord(value) && "@call" in value);
  const visit = (
    value: unknown,
    steps: readonly string[],
  ): string | undefined => {
    // A bound or computed value, at the reference or above it, is known
    // only at render.
    if (isDynamic(value)) return undefined;
    if (steps.length === 0) {
      const reason = slotProblem(value, ref.kind, ownId);
      return reason ? `${label}: ${reason}` : undefined;
    }
    const [head, ...rest] = steps;
    if (head === "*") {
      if (!Array.isArray(value)) return undefined;
      for (const item of value) {
        const reason = visit(item, rest);
        if (reason) return reason;
      }
      return undefined;
    }
    if (!isRecord(value) || !hasOwn(value, head)) return undefined;
    return visit(value[head], rest);
  };
  return visit(node, ref.path);
}
