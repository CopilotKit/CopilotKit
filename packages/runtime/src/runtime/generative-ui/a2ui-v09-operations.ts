import { EventType } from "@ag-ui/client";
import type {
  ActivityDeltaEvent,
  ActivitySnapshotEvent,
  BaseEvent,
} from "@ag-ui/client";
import {
  A2UI_VERSION,
  GENERATIVE_UI_ACTIVITY_TYPE,
  GENERATIVE_UI_CHAT_TARGET,
  cloneValue,
  generativeUISurfaceMessageId,
} from "@copilotkit/shared";
import type {
  A2UIComponentNode,
  A2UIOperation,
  GenerativeUIRejectedOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import { STANDARD_CATALOG_ID } from "@copilotkit/shared/generative-ui";
import { isRecord } from "../../agent/converters/usage";

/**
 * The activity type and content key of v0.9 surfaces, as
 * `@ag-ui/a2ui-middleware`, `@ag-ui/a2a` and the Python helpers emit them.
 */
const A2UI_SURFACE_ACTIVITY_TYPE = "a2ui-surface";
const A2UI_OPERATIONS_KEY = "a2ui_operations";

/** The `version` values of A2UI v0.9 messages. */
const V09_VERSIONS: ReadonlySet<string> = new Set(["v0.9", "v0.9.1"]);
const V09_KINDS = [
  "createSurface",
  "updateComponents",
  "updateDataModel",
  "deleteSurface",
] as const;
type V09Kind = (typeof V09_KINDS)[number];

/**
 * The ids of the v0.9 basic catalog: the one agents send, and the `$id` of
 * the published catalog document. Both become the standard catalog, which has
 * the same 18 components.
 */
const V09_BASIC_CATALOG_IDS: ReadonlySet<string> = new Set([
  "https://a2ui.org/specification/v0_9/basic_catalog.json",
  "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
]);

/**
 * The ids of the A2UI 1.0 basic catalog, which native 1.0 agents (for
 * example ADK) send. It has the 18 components of the v0.9 basic catalog
 * with 1.0 bindings, so it becomes the standard catalog too.
 */
const V10_BASIC_CATALOG_IDS: ReadonlySet<string> = new Set([
  "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
]);

/** The A2UI version that an `a2ui-surface` operation was written in. */
type SourceVersion = "0.9" | "1.0";

/** v0.9 `Text` heading variants as 1.0 `Title` sizes, largest first. */
const HEADING_SIZES: Readonly<Record<string, string>> = {
  h1: "2xl",
  h2: "xl",
  h3: "lg",
  h4: "md",
  h5: "sm",
};

/** The one v0.9 operation key of `op`, when it has exactly one. */
function v09Kind(op: Record<string, unknown>): V09Kind | undefined {
  const kinds = V09_KINDS.filter((kind) => kind in op);
  return kinds.length === 1 ? kinds[0] : undefined;
}

/**
 * True for an A2UI v0.9 operation: an object whose `version` is `"v0.9"` (or
 * `"v0.9.1"`). An object without `version` counts when it has exactly one
 * v0.9 operation key with an object payload. A 1.0 operation always carries
 * `version: "1.0"` (the client rejects one without it), and v0.8 uses other
 * keys (`beginRendering`, `surfaceUpdate`), so a versionless operation with
 * a v0.9 key can only be v0.9. Agents leave `version` out often enough that
 * requiring it would drop their surfaces.
 *
 * @example
 * ```ts
 * isA2UIV09Operation({ version: "v0.9", deleteSurface: { surfaceId: "s" } }); // true
 * isA2UIV09Operation({ deleteSurface: { surfaceId: "s" } }); // true
 * isA2UIV09Operation({ version: "1.0", deleteSurface: { surfaceId: "s" } }); // false
 * ```
 */
export function isA2UIV09Operation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.version !== undefined) {
    return typeof value.version === "string" && V09_VERSIONS.has(value.version);
  }
  const kind = v09Kind(value);
  return kind !== undefined && isRecord(value[kind]);
}

// Checked with `ok === false`: runtime compiles non-strict, where a check of
// `reason` does not narrow the union.
type Converted<T> = { ok: true; value: T } | { ok: false; reason: string };

const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
const failed = (reason: string): { ok: false; reason: string } => ({
  ok: false,
  reason,
});

/**
 * A v0.9 dynamic value as 1.0: `{ path }` becomes `{ "@path" }` and
 * `{ call, args }` becomes `{ "@call", args }`, at any depth. Literals stay.
 */
function convertValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(convertValue);
  if (!isRecord(value)) return value;
  const keys = Object.keys(value);
  if (keys.length === 1 && typeof value.path === "string") {
    return { "@path": value.path };
  }
  const isCall =
    typeof value.call === "string" &&
    keys.every(
      (key) => key === "call" || key === "args" || key === "returnType",
    );
  if (isCall) return convertCall(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, convertValue(item)]),
  );
}

/** A v0.9 function call `{ call, args, returnType }` as `{ "@call", args }`. */
function convertCall(call: Record<string, unknown>) {
  return {
    "@call": call.call as string,
    ...(call.args === undefined ? {} : { args: convertValue(call.args) }),
  };
}

/** `{ event: {...} }` or `{ functionCall: {...} }`: the v0.9 Action. */
function isV09Action(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 1 && (isRecord(value.event) || isRecord(value.functionCall))
  );
}

/**
 * A v0.9 action as a 1.0 event binding. The event keeps its name and
 * context (with converted values); a function call gets the `@call` form.
 */
function convertAction(action: unknown): Converted<unknown> {
  if (!isV09Action(action)) {
    return failed('action must be { "event": ... } or { "functionCall": ... }');
  }
  if (isRecord(action.functionCall)) {
    const call = action.functionCall;
    if (typeof call.call !== "string" || !call.call) {
      return failed("action.functionCall.call must be a function name");
    }
    return ok({ functionCall: convertCall(call) });
  }
  const event = action.event as Record<string, unknown>;
  if (typeof event.name !== "string" || !event.name) {
    return failed("action.event.name is required");
  }
  return ok({
    event: {
      name: event.name,
      ...(event.context === undefined
        ? {}
        : { context: convertValue(event.context) }),
    },
  });
}

/**
 * The basic-catalog changes of one component. Every other prop keeps its
 * name; the 1.0 standard catalog uses the v0.9 names.
 *
 * - `Text` with a heading `variant` becomes `Title` (h1 "2xl" to h5 "sm"),
 *   with `caption` it becomes `Caption`; `variant` goes. Title and Caption
 *   have no `weight`, so it goes too.
 * - `Button.action` becomes `onClick`.
 * - `TextField.validationRegexp` becomes a `regex` check on its value.
 */
function applyBasicCatalogChanges(node: Record<string, unknown>) {
  if (node.component === "Text" && "variant" in node) {
    const { variant, ...rest } = node;
    const size =
      typeof variant === "string" ? HEADING_SIZES[variant] : undefined;
    if (size !== undefined) {
      const { weight: _weight, ...title } = rest;
      return { ...title, component: "Title", size };
    }
    if (variant === "caption") {
      const { weight: _weight, ...caption } = rest;
      return { ...caption, component: "Caption" };
    }
    return rest;
  }
  if (node.component === "Button" && "action" in node) {
    const { action, ...rest } = node;
    return { ...rest, onClick: action };
  }
  if (node.component === "TextField" && "validationRegexp" in node) {
    const { validationRegexp, ...rest } = node;
    if (typeof validationRegexp !== "string" || rest.value === undefined) {
      return rest;
    }
    const check = {
      condition: {
        "@call": "regex",
        args: { value: rest.value, pattern: validationRegexp },
      },
    };
    const checks = Array.isArray(rest.checks) ? rest.checks : [];
    return { ...rest, checks: [...checks, check] };
  }
  return node;
}

/** One v0.9 component (flat format) as a 1.0 component node. */
function convertComponent(node: unknown): Converted<A2UIComponentNode> {
  if (!isRecord(node) || typeof node.id !== "string" || !node.id) {
    return failed("a component needs a string id");
  }
  if (typeof node.component !== "string" || !node.component) {
    return failed(
      `component "${node.id}": the component type must be a string (the v0.9 flat format)`,
    );
  }
  const converted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "id" || key === "component") {
      converted[key] = value;
    } else if (key === "action" || isV09Action(value)) {
      const action = convertAction(value);
      if (action.ok === false) {
        return failed(`component "${node.id}": ${action.reason}`);
      }
      converted[key] = action.value;
    } else {
      converted[key] = convertValue(value);
    }
  }
  return ok(applyBasicCatalogChanges(converted) as A2UIComponentNode);
}

function convertUpdateComponents(
  payload: Record<string, unknown>,
  surfaceId: string,
): Converted<A2UIOperation> {
  const { components } = payload;
  if (!Array.isArray(components) || components.length === 0) {
    return failed("updateComponents.components must be a non-empty array");
  }
  const nodes: A2UIComponentNode[] = [];
  for (const component of components) {
    const converted = convertComponent(component);
    if (converted.ok === false) return converted;
    nodes.push(converted.value);
  }
  return ok<A2UIOperation>({
    version: A2UI_VERSION,
    updateComponents: { surfaceId, components: nodes },
  });
}

/**
 * v0.9 removes the key at `path` when `value` is left out; 1.0 removes it
 * for `null`. At the root, removing means an empty data model.
 */
function convertUpdateDataModel(
  payload: Record<string, unknown>,
  surfaceId: string,
): Converted<A2UIOperation> {
  const { path, value } = payload;
  if (path !== undefined && typeof path !== "string") {
    return failed("updateDataModel.path must be a string");
  }
  const relative = typeof path === "string" ? path : "";
  const pointer = relative.startsWith("/") ? relative : `/${relative}`;
  const isRoot = pointer === "/";
  if (isRoot && value !== undefined && !isRecord(value)) {
    return failed(
      "a root updateDataModel value must be a JSON object in A2UI 1.0",
    );
  }
  const nextValue = value === undefined ? (isRoot ? {} : null) : value;
  return ok<A2UIOperation>({
    version: A2UI_VERSION,
    updateDataModel: { surfaceId, path: pointer, value: nextValue },
  });
}

function convertCreateSurface(
  payload: Record<string, unknown>,
  surfaceId: string,
): A2UIOperation {
  const { catalogId } = payload;
  const sendDataModel = payload.sendDataModel ?? payload.attachDataModel;
  return {
    version: A2UI_VERSION,
    createSurface: {
      surfaceId,
      ...(typeof catalogId === "string" && catalogId
        ? {
            catalogId: V09_BASIC_CATALOG_IDS.has(catalogId)
              ? STANDARD_CATALOG_ID
              : catalogId,
          }
        : {}),
      ...(typeof sendDataModel === "boolean" ? { sendDataModel } : {}),
    },
  };
}

/** Basic catalog components as standard ones; anything else stays. */
function standardComponents(components: unknown) {
  return Array.isArray(components)
    ? components.map((node) =>
        isRecord(node) ? applyBasicCatalogChanges(node) : node,
      )
    : components;
}

/**
 * A native A2UI 1.0 operation, for the standard catalog: the 1.0 basic
 * catalog id becomes the standard catalog id, and the basic catalog
 * components (inline in createSurface, or in updateComponents) get the
 * changes of {@link applyBasicCatalogChanges}. Bindings are already 1.0.
 * Everything else stays; the client validates the operation.
 */
function upgradeV10Operation(op: Record<string, unknown>): A2UIOperation {
  const { createSurface: create, updateComponents: update } = op;
  if (isRecord(create)) {
    const { catalogId } = create;
    return {
      ...op,
      createSurface: {
        ...create,
        ...(typeof catalogId === "string" &&
        V10_BASIC_CATALOG_IDS.has(catalogId)
          ? { catalogId: STANDARD_CATALOG_ID }
          : {}),
        ...(create.components === undefined
          ? {}
          : { components: standardComponents(create.components) }),
      },
    } as A2UIOperation;
  }
  if (isRecord(update)) {
    return {
      ...op,
      updateComponents: {
        ...update,
        ...(update.components === undefined
          ? {}
          : { components: standardComponents(update.components) }),
      },
    } as A2UIOperation;
  }
  return op as A2UIOperation;
}

/** One operation as 1.0, or why it cannot be converted. */
function upgradeOperation(op: unknown): Converted<A2UIOperation> {
  if (!isRecord(op)) return failed("operation must be a JSON object");
  if (op.version === A2UI_VERSION) return ok(upgradeV10Operation(op));
  if (!isA2UIV09Operation(op)) {
    return failed(
      typeof op.version === "string"
        ? `unsupported A2UI version "${op.version}"; only v0.9 and 1.0 operations are supported`
        : `not an A2UI v0.9 operation: it needs exactly one of ${V09_KINDS.join(", ")}`,
    );
  }
  const kind = v09Kind(op);
  if (!kind) {
    return failed(
      `operation must contain exactly one of ${V09_KINDS.join(", ")}`,
    );
  }
  const payload = op[kind];
  if (
    !isRecord(payload) ||
    typeof payload.surfaceId !== "string" ||
    !payload.surfaceId
  ) {
    return failed(`${kind}.surfaceId is required`);
  }
  const { surfaceId } = payload;
  switch (kind) {
    case "createSurface":
      return ok(convertCreateSurface(payload, surfaceId));
    case "updateComponents":
      return convertUpdateComponents(payload, surfaceId);
    case "updateDataModel":
      return convertUpdateDataModel(payload, surfaceId);
    case "deleteSurface":
      return ok<A2UIOperation>({
        version: A2UI_VERSION,
        deleteSurface: { surfaceId },
      });
  }
}

/**
 * Converts A2UI v0.9 operations to A2UI 1.0, in order. Pure; never throws.
 *
 * - createSurface: the v0.9 basic catalog id becomes the standard catalog
 *   id (`copilotkit/standard@1`); any other catalog id stays. `theme` has no
 *   1.0 field and goes; `sendDataModel` stays.
 * - updateComponents: `{ path }` becomes `{ "@path" }` and `{ call, args }`
 *   becomes `{ "@call", args }` at any depth; an action becomes an
 *   `{ event }` or `{ functionCall }` binding; child lists and templates
 *   stay. See {@link applyBasicCatalogChanges} for the props that change.
 * - updateDataModel: a left-out `value` (remove) becomes `null`, or `{}` at
 *   the root.
 * - deleteSurface: unchanged.
 *
 * An operation that is already 1.0 (native, for example from ADK) keeps its
 * form: only the 1.0 basic catalog id becomes the standard catalog id, and
 * its basic catalog components get the same changes as v0.9 ones. Any other
 * operation, and any v0.9 operation that cannot be converted, goes to
 * `dropped` with the reason.
 *
 * @example
 * ```ts
 * upgradeA2UIV09Operations([
 *   { version: "v0.9", updateDataModel: { surfaceId: "s", path: "/x" } },
 * ]);
 * // { operations: [{ version: "1.0", updateDataModel: { surfaceId: "s", path: "/x", value: null } }], dropped: [] }
 * ```
 */
export function upgradeA2UIV09Operations(operations: unknown[]): {
  operations: A2UIOperation[];
  dropped: Array<{ operation: unknown; reason: string }>;
} {
  const upgraded: A2UIOperation[] = [];
  const dropped: Array<{ operation: unknown; reason: string }> = [];
  for (const operation of Array.isArray(operations) ? operations : []) {
    let result: Converted<A2UIOperation>;
    try {
      result = upgradeOperation(operation);
    } catch (error) {
      // A getter or a Proxy trap of the operation threw while it was read.
      result = failed(
        `operation could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (result.ok === false) {
      dropped.push({ operation, reason: result.reason });
    } else {
      upgraded.push(result.value);
    }
  }
  return { operations: upgraded, dropped };
}

/** The nested `surfaceId` of a v0.9 or 1.0 surface operation. */
function surfaceIdOf(op: unknown) {
  if (!isRecord(op)) return undefined;
  for (const kind of V09_KINDS) {
    const payload = op[kind];
    if (isRecord(payload) && typeof payload.surfaceId === "string") {
      return payload.surfaceId || undefined;
    }
  }
  return undefined;
}

/** The operations of `a2ui-surface` content. Lifecycle content has none. */
function readOperations(content: unknown): unknown[] {
  if (!isRecord(content)) return [];
  const operations = content[A2UI_OPERATIONS_KEY] ?? content.operations;
  return Array.isArray(operations) ? operations : [];
}

type JsonPatchOperation = {
  op: "add" | "remove" | "replace" | "move" | "copy" | "test";
  path: string;
  from?: string;
  value?: unknown;
};

function pointerSegments(pointer: string) {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) throw new Error(`invalid pointer "${pointer}"`);
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Applies RFC 6902 operations to `document` in place and returns the new
 * root. Throws on a path that does not resolve, like `fast-json-patch` in
 * the AG-UI client, so a bad delta leaves the stored content alone.
 */
function applyJsonPatch(document: unknown, patch: unknown): unknown {
  if (!Array.isArray(patch)) throw new Error("patch must be an array");
  let root = document;
  const parentOf = (pointer: string) => {
    const segments = pointerSegments(pointer);
    const key = segments.pop();
    let parent: unknown = root;
    for (const segment of segments) {
      if (FORBIDDEN_SEGMENTS.has(segment)) throw new Error("forbidden path");
      parent = Array.isArray(parent)
        ? parent[Number(segment)]
        : isRecord(parent)
          ? parent[segment]
          : undefined;
      if (parent === undefined) throw new Error(`path "${pointer}" not found`);
    }
    if (key !== undefined && FORBIDDEN_SEGMENTS.has(key)) {
      throw new Error("forbidden path");
    }
    return { parent, key };
  };
  const read = (pointer: string) => {
    const { parent, key } = parentOf(pointer);
    if (key === undefined) return root;
    if (Array.isArray(parent)) return parent[Number(key)];
    return isRecord(parent) ? parent[key] : undefined;
  };
  const remove = (pointer: string) => {
    const { parent, key } = parentOf(pointer);
    if (key === undefined) throw new Error("cannot remove the root");
    if (Array.isArray(parent)) parent.splice(Number(key), 1);
    else if (isRecord(parent) && key in parent) delete parent[key];
    else throw new Error(`path "${pointer}" not found`);
  };
  const write = (pointer: string, value: unknown, insert: boolean) => {
    const { parent, key } = parentOf(pointer);
    if (key === undefined) {
      root = value;
    } else if (Array.isArray(parent)) {
      const index = key === "-" ? parent.length : Number(key);
      if (!Number.isInteger(index) || index < 0 || index > parent.length) {
        throw new Error(`index "${key}" is out of range`);
      }
      parent.splice(index, insert ? 0 : 1, value);
    } else if (isRecord(parent)) {
      parent[key] = value;
    } else {
      throw new Error(`path "${pointer}" not found`);
    }
  };
  for (const entry of patch as JsonPatchOperation[]) {
    if (!isRecord(entry) || typeof entry.path !== "string") {
      throw new Error("invalid patch operation");
    }
    switch (entry.op) {
      case "add":
        write(entry.path, cloneValue(entry.value), true);
        break;
      case "replace":
        if (read(entry.path) === undefined) {
          throw new Error(`path "${entry.path}" not found`);
        }
        write(entry.path, cloneValue(entry.value), false);
        break;
      case "remove":
        remove(entry.path);
        break;
      case "copy":
        write(entry.path, cloneValue(read(entry.from ?? "")), true);
        break;
      case "move": {
        const value = read(entry.from ?? "");
        remove(entry.from ?? "");
        write(entry.path, value, true);
        break;
      }
      case "test":
        if (JSON.stringify(read(entry.path)) !== JSON.stringify(entry.value)) {
          throw new Error(`test failed at "${entry.path}"`);
        }
        break;
      default:
        throw new Error(`unknown patch op "${String(entry.op)}"`);
    }
  }
  return root;
}

/** One converted operation, with where it came from. */
interface SourceOperation {
  operation: A2UIOperation;
  /** Its index in the source message. */
  index: number;
  version: SourceVersion;
}

/** The converted part of one surface that one source message holds. */
interface SourcePart {
  operations: SourceOperation[];
  rejected: GenerativeUIRejectedOperation[];
}

interface SurfaceState {
  /** The part of each source message, in the order they first touched it. */
  parts: Map<string, SourcePart>;
  /** JSON of the last snapshot content. */
  lastSnapshot?: string;
  /** Operations sent as deltas, for a surface created in an earlier run. */
  sentOperations: A2UIOperation[];
  /** JSON of the last `rejected` sent as a delta. */
  sentRejected: string;
}

/**
 * Converts the `a2ui-surface` surfaces of one run (A2UI v0.9, or native
 * A2UI 1.0) to `generative-ui-surface` surfaces. Create one per run and pass
 * every event of the run through `transform`, in order.
 *
 * - An `a2ui-surface` `ACTIVITY_SNAPSHOT` or `ACTIVITY_DELTA` is kept per
 *   messageId (a delta is applied to the stored content), and its
 *   operations are converted with {@link upgradeA2UIV09Operations}.
 * - Each surface becomes one `generative-ui-surface` message,
 *   `genui:<surfaceId>`, like a `render_ui` surface. A surface that is
 *   created in this run is sent as an `ACTIVITY_SNAPSHOT` with the
 *   cumulative 1.0 content: the operations of every source message for it,
 *   in order, with only the first createSurface. The target is the chat,
 *   the status is "ready", dropped operations are `rejected` (at their
 *   index in the source message), and `a2uiSourceVersion` is "0.9" for a
 *   surface written in v0.9.
 * - A surface written in native A2UI 1.0 (`version: "1.0"`, for example
 *   from ADK) becomes the same `generative-ui-surface` message, without
 *   `a2uiSourceVersion`: a click on it is a 1.0 action, so it reaches the
 *   agent unchanged. One surface has one version, the version of its
 *   first operation; an operation of the other version is rejected.
 * - A surface that this run updates but does not create (v0.9 sends no
 *   second createSurface) was created in an earlier run, so its new
 *   operations are appended to its message with an `ACTIVITY_DELTA`, as
 *   the `render_ui` path updates an existing surface.
 * - A lifecycle snapshot (`status: "building"` and so on, no operations)
 *   names no surface, so it is consumed. Every other event passes through.
 *
 * @example
 * ```ts
 * const upgrader = createA2UIV09ActivityUpgrader();
 * source.pipe(mergeMap((event) => upgrader.transform(event)));
 * ```
 */
export function createA2UIV09ActivityUpgrader(): {
  transform(event: BaseEvent): BaseEvent[];
} {
  const sources = new Map<string, unknown>();
  const surfaces = new Map<string, SurfaceState>();

  const snapshotOf = (
    surfaceId: string,
    state: SurfaceState,
    operations: A2UIOperation[],
    rejected: GenerativeUIRejectedOperation[],
    version: SourceVersion,
  ): BaseEvent[] => {
    const create = operations.find((op) => "createSurface" in op);
    const catalogId =
      (create && "createSurface" in create && create.createSurface.catalogId) ||
      STANDARD_CATALOG_ID;
    const content: GenerativeUISurfaceContent = {
      surfaceId,
      target: GENERATIVE_UI_CHAT_TARGET,
      catalogId,
      operations,
      status: "ready",
      rejected,
      ...(version === "0.9" ? { a2uiSourceVersion: "0.9" as const } : {}),
    };
    const json = JSON.stringify(content);
    if (json === state.lastSnapshot) return [];
    state.lastSnapshot = json;
    const event: ActivitySnapshotEvent = {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: generativeUISurfaceMessageId(surfaceId),
      activityType: GENERATIVE_UI_ACTIVITY_TYPE,
      content: cloneValue(content),
      replace: true,
    };
    return [event];
  };

  const deltaOf = (
    surfaceId: string,
    state: SurfaceState,
    operations: A2UIOperation[],
    rejected: GenerativeUIRejectedOperation[],
  ): BaseEvent[] => {
    const sent = state.sentOperations;
    let same = 0;
    while (
      same < sent.length &&
      same < operations.length &&
      JSON.stringify(sent[same]) === JSON.stringify(operations[same])
    ) {
      same++;
    }
    // Operations that changed after they were sent cannot be taken back.
    // v0.9 updates replace by id or path, so sending them again is safe.
    const patch: unknown[] = operations.slice(same).map((op) => ({
      op: "add",
      path: "/operations/-",
      value: cloneValue(op),
    }));
    const rejectedJson = JSON.stringify(rejected);
    if (rejectedJson !== state.sentRejected) {
      patch.push({ op: "replace", path: "/rejected", value: rejected });
    }
    state.sentOperations = operations;
    state.sentRejected = rejectedJson;
    if (patch.length === 0) return [];
    const event: ActivityDeltaEvent = {
      type: EventType.ACTIVITY_DELTA,
      messageId: generativeUISurfaceMessageId(surfaceId),
      activityType: GENERATIVE_UI_ACTIVITY_TYPE,
      patch: patch as ActivityDeltaEvent["patch"],
    };
    return [event];
  };

  const emitSurface = (surfaceId: string): BaseEvent[] => {
    const state = surfaces.get(surfaceId);
    if (!state) return [];
    const operations: A2UIOperation[] = [];
    const rejected: GenerativeUIRejectedOperation[] = [];
    let created = false;
    let version: SourceVersion | undefined;
    for (const part of state.parts.values()) {
      for (const { operation, index, version: opVersion } of part.operations) {
        version ??= opVersion;
        if (opVersion !== version) {
          rejected.push({
            index,
            reason: `surface "${surfaceId}" is A2UI ${version}; an A2UI ${opVersion} operation cannot change it`,
          });
          continue;
        }
        if ("createSurface" in operation) {
          // A second createSurface of the same id is rejected in 1.0.
          if (created) continue;
          created = true;
        }
        operations.push(operation);
      }
      rejected.push(...part.rejected);
    }
    return created
      ? snapshotOf(surfaceId, state, operations, rejected, version ?? "0.9")
      : deltaOf(surfaceId, state, operations, rejected);
  };

  /** Converts the stored content of one source message again. */
  const refresh = (messageId: string): BaseEvent[] => {
    const parts = new Map<string, SourcePart>();
    readOperations(sources.get(messageId)).forEach((op, index) => {
      // An operation with no surface cannot be shown anywhere.
      const surfaceId = surfaceIdOf(op);
      if (surfaceId === undefined) return;
      let part = parts.get(surfaceId);
      if (!part) {
        part = { operations: [], rejected: [] };
        parts.set(surfaceId, part);
      }
      const { operations, dropped } = upgradeA2UIV09Operations([op]);
      // Only v0.9 and 1.0 operations convert.
      const version: SourceVersion =
        isRecord(op) && op.version === A2UI_VERSION ? "1.0" : "0.9";
      for (const operation of operations) {
        part.operations.push({ operation, index, version });
      }
      for (const { reason } of dropped) part.rejected.push({ index, reason });
    });
    const touched = new Set(parts.keys());
    for (const [surfaceId, state] of surfaces) {
      if (!parts.has(surfaceId) && state.parts.delete(messageId)) {
        touched.add(surfaceId);
      }
    }
    for (const [surfaceId, part] of parts) {
      let state = surfaces.get(surfaceId);
      if (!state) {
        state = { parts: new Map(), sentOperations: [], sentRejected: "[]" };
        surfaces.set(surfaceId, state);
      }
      state.parts.set(messageId, part);
    }
    return [...touched].flatMap(emitSurface);
  };

  return {
    transform(event) {
      if (event.type === EventType.ACTIVITY_SNAPSHOT) {
        const snapshot = event as ActivitySnapshotEvent;
        if (snapshot.activityType !== A2UI_SURFACE_ACTIVITY_TYPE) {
          return [event];
        }
        const { messageId } = snapshot;
        // `replace: false` does not replace a message that already exists.
        if (snapshot.replace === false && sources.has(messageId)) return [];
        sources.set(messageId, cloneValue(snapshot.content));
        return refresh(messageId);
      }
      if (event.type === EventType.ACTIVITY_DELTA) {
        const delta = event as ActivityDeltaEvent;
        if (delta.activityType !== A2UI_SURFACE_ACTIVITY_TYPE) return [event];
        const { messageId } = delta;
        if (!sources.has(messageId)) return [];
        let content: unknown;
        try {
          content = applyJsonPatch(
            cloneValue(sources.get(messageId)),
            delta.patch,
          );
        } catch {
          // The AG-UI client also skips a delta that does not apply.
          return [];
        }
        sources.set(messageId, content);
        return refresh(messageId);
      }
      return [event];
    },
  };
}
