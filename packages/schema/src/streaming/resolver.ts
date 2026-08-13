import type {
  GenericSchema,
  InferStream,
  Schema,
  StreamingAction,
} from "../index.js";
import type {
  JsonAstNode,
  ParserOperation,
  ParserState,
  StreamingErrorCode,
} from "./parser.js";
import { getResolvedValue } from "./parser.js";

export type StreamNodeStatus = "missing" | "partial" | "complete" | "invalid";
export type StreamPath<T> = T extends readonly (infer TItem)[]
  ? readonly [number, ...StreamPath<TItem>] | readonly []
  : T extends object
    ? {
        [TKey in keyof T & (string | number)]:
          | readonly [TKey]
          | readonly [TKey, ...StreamPath<NonNullable<T[TKey]>>];
      }[keyof T & (string | number)]
    : readonly [];

export interface StreamReadiness<T> {
  readonly statuses: Readonly<Record<string, StreamNodeStatus>>;
  readonly "~value"?: T;
}

export interface ResolutionCache {
  readonly values: Readonly<Record<string, unknown>>;
  readonly readiness: Readonly<Record<string, StreamNodeStatus>>;
  readonly lastValue?: unknown;
}

export type StreamingResolution<T> =
  | {
      readonly status: "match";
      readonly value: T;
      readonly readiness: StreamReadiness<T>;
      readonly changed: boolean;
      readonly cache: ResolutionCache;
    }
  | { readonly status: "no-match"; readonly cache: ResolutionCache }
  | {
      readonly status: "invalid";
      readonly error: StreamingResolutionError;
      readonly cache: ResolutionCache;
    };

export interface StreamingResolutionError {
  readonly code: StreamingErrorCode | "schema_invalid";
  readonly message: string;
  readonly index?: number;
  readonly line?: number;
  readonly column?: number;
  readonly limit?: number;
  readonly observed?: number;
}

type SchemaShape = Schema<unknown, unknown> & {
  readonly actions: readonly {
    readonly actionType?: string;
    readonly kind: "transformation" | "validation";
    readonly "~run": (input: unknown) => unknown;
  }[];
  readonly wrapped: Schema<unknown, unknown>;
};

interface ResolveContext {
  readonly nodes: readonly JsonAstNode[];
  readonly prior: ResolutionCache;
  values: Record<string, unknown>;
  statuses: Record<string, StreamNodeStatus>;
}

type NodeResolution =
  | { readonly status: "match"; readonly value: unknown }
  | { readonly status: "no-match" }
  | { readonly status: "invalid"; readonly message: string };

function pathKey(path: readonly (string | number)[]): string {
  return JSON.stringify(path);
}

function isSchemaShape(
  schema: Schema<unknown, unknown>,
): schema is SchemaShape {
  return "actions" in schema && "wrapped" in schema;
}

function checkpointIndex(schema: Schema<unknown, unknown>): number {
  if (!isSchemaShape(schema)) {
    return -1;
  }
  return schema.actions.findIndex(
    (action) => action.actionType === "streaming",
  );
}

function hasWrappedSchema(schema: Schema<unknown, unknown>): schema is Schema<
  unknown,
  unknown
> & {
  readonly wrapped: Schema<unknown, unknown>;
} {
  return "wrapped" in schema;
}

function hasStreamingCheckpoint(schema: Schema<unknown, unknown>): boolean {
  if (checkpointIndex(schema) >= 0) return true;
  return hasWrappedSchema(schema)
    ? hasStreamingCheckpoint(schema.wrapped)
    : false;
}

/** Return whether the local schema pipeline contains a streaming checkpoint. */
export function isStreamingSchema(
  schema: GenericSchema<unknown, unknown>,
): boolean {
  return hasStreamingCheckpoint(schema as unknown as Schema<unknown, unknown>);
}

/** Create the explicit immutable cache used to retain branch identity. */
export function createResolutionCache(): ResolutionCache {
  return { values: {}, readiness: {} };
}

function reuseValue(
  context: ResolveContext,
  path: readonly (string | number)[],
  value: unknown,
): unknown {
  const key = pathKey(path);
  const prior = context.prior.values[key];
  let output = value;
  if (Array.isArray(prior) && Array.isArray(value)) {
    output =
      prior.length === value.length &&
      prior.every((item, index) => item === value[index])
        ? prior
        : value;
  } else if (
    prior !== null &&
    value !== null &&
    typeof prior === "object" &&
    typeof value === "object" &&
    !Array.isArray(prior) &&
    !Array.isArray(value)
  ) {
    const priorObject = prior as Record<string, unknown>;
    const valueObject = value as Record<string, unknown>;
    const keys = Object.keys(valueObject);
    output =
      keys.length === Object.keys(priorObject).length &&
      keys.every((key) => priorObject[key] === valueObject[key])
        ? prior
        : value;
  } else if (prior === value) {
    output = prior;
  }
  context.values[key] = output;
  return output;
}

function setStatus(
  context: ResolveContext,
  path: readonly (string | number)[],
  status: StreamNodeStatus,
): void {
  context.statuses[pathKey(path)] = status;
}

type EmptyResolution =
  | { readonly status: "match"; readonly value: unknown }
  | { readonly status: "no-match" };

function compatibleEmpty(schema: Schema<unknown, unknown>): EmptyResolution {
  if ("~optional" in schema) return { status: "no-match" };
  let current = schema;
  if (isSchemaShape(current)) {
    if (checkpointIndex(current) < 0) {
      return hasStreamingCheckpoint(current.wrapped)
        ? compatibleEmpty(current.wrapped)
        : { status: "no-match" };
    }
    current = current.wrapped;
  } else if (hasWrappedSchema(current)) {
    return hasStreamingCheckpoint(current.wrapped)
      ? compatibleEmpty(current.wrapped)
      : { status: "no-match" };
  }
  if (current.type === "string") return { status: "match", value: "" };
  if (current.type === "array") return { status: "match", value: [] };
  if (current.type === "object" && "entries" in current) {
    const output: Record<string, unknown> = {};
    const entries = current.entries as Record<string, Schema<unknown, unknown>>;
    for (const [key, childSchema] of Object.entries(entries)) {
      if ("~optional" in childSchema) continue;
      const child = compatibleEmpty(childSchema);
      if (child.status === "no-match") return child;
      output[key] = child.value;
    }
    return { status: "match", value: output };
  }
  return { status: "no-match" };
}

function applyCheckpointActions(
  schema: SchemaShape,
  value: unknown,
  terminal: boolean,
): NodeResolution {
  const marker = checkpointIndex(schema);
  let output = value;
  try {
    for (let index = 0; index < marker; index += 1) {
      output = schema.actions[index]!["~run"](output);
    }
  } catch (error) {
    return terminal
      ? {
          status: "invalid",
          message:
            error instanceof Error
              ? error.message
              : "Checkpoint action rejected the completed value",
        }
      : { status: "no-match" };
  }
  return { status: "match", value: output };
}

function resolveNode(
  schema: Schema<unknown, unknown>,
  node: JsonAstNode | undefined,
  path: readonly (string | number)[],
  context: ResolveContext,
): NodeResolution {
  const hasCheckpoint = checkpointIndex(schema) >= 0;
  if (
    !hasCheckpoint &&
    hasWrappedSchema(schema) &&
    hasStreamingCheckpoint(schema.wrapped)
  ) {
    if (!node && "~optional" in schema) {
      setStatus(context, path, "missing");
      return { status: "no-match" };
    }
    return resolveNode(schema.wrapped, node, path, context);
  }
  const base = isSchemaShape(schema) ? schema.wrapped : schema;
  if (!node) {
    const empty = compatibleEmpty(schema);
    if (empty.status === "match") {
      setStatus(context, path, "missing");
      return {
        status: "match",
        value: reuseValue(context, path, empty.value),
      };
    }
    setStatus(context, path, "missing");
    return { status: "no-match" };
  }

  let candidate: unknown;
  if (base.type === "string") {
    if (node.type !== "string") {
      setStatus(context, path, node.closed ? "invalid" : "missing");
      return node.closed
        ? { status: "invalid", message: "Expected string" }
        : { status: "no-match" };
    }
    if (!node.closed && !hasCheckpoint) {
      setStatus(context, path, "missing");
      return { status: "no-match" };
    }
    candidate = node.resolvedValue;
  } else if ("options" in base && Array.isArray(base.options)) {
    let invalid: NodeResolution | undefined;
    let sawNoMatch = false;
    let matchedContext: ResolveContext | undefined;
    let matched: NodeResolution | undefined;
    for (const option of base.options as Schema<unknown, unknown>[]) {
      const optionContext: ResolveContext = {
        nodes: context.nodes,
        prior: context.prior,
        values: { ...context.values },
        statuses: { ...context.statuses },
      };
      const result = resolveNode(option, node, path, optionContext);
      if (result.status === "match") {
        matched = result;
        matchedContext = optionContext;
        break;
      }
      if (result.status === "no-match") sawNoMatch = true;
      else invalid = result;
    }
    if (!matched || matched.status !== "match" || !matchedContext) {
      if (sawNoMatch || !invalid) return { status: "no-match" };
      return invalid;
    }
    context.values = matchedContext.values;
    context.statuses = matchedContext.statuses;
    candidate = matched.value;
  } else if (base.type === "object" && "entries" in base) {
    if (node.type !== "object") {
      setStatus(context, path, node.closed ? "invalid" : "missing");
      return node.closed
        ? { status: "invalid", message: "Expected object" }
        : { status: "no-match" };
    }
    const entries = base.entries as Record<string, Schema<unknown, unknown>>;
    const output: Record<string, unknown> = {};
    for (const [key, childSchema] of Object.entries(entries)) {
      const childIndex = node.keys.indexOf(key);
      const childNode =
        childIndex < 0 ? undefined : context.nodes[node.children[childIndex]!];
      const child = resolveNode(
        childSchema,
        childNode,
        [...path, key],
        context,
      );
      if (child.status === "match") {
        output[key] = child.value;
      } else if (child.status === "invalid") {
        setStatus(context, path, "invalid");
        return child;
      } else if (!("~optional" in childSchema)) {
        setStatus(context, path, "missing");
        return { status: "no-match" };
      }
    }
    candidate = reuseValue(context, path, output);
  } else if (base.type === "array" && "item" in base) {
    if (node.type !== "array") {
      setStatus(context, path, node.closed ? "invalid" : "missing");
      return node.closed
        ? { status: "invalid", message: "Expected array" }
        : { status: "no-match" };
    }
    if (!node.closed && !hasCheckpoint) {
      setStatus(context, path, "missing");
      return { status: "no-match" };
    }
    const output: unknown[] = [];
    for (let index = 0; index < node.children.length; index += 1) {
      const child = resolveNode(
        base.item as Schema<unknown, unknown>,
        context.nodes[node.children[index]!],
        [...path, index],
        context,
      );
      if (child.status === "match") output.push(child.value);
      else break;
    }
    candidate = reuseValue(context, path, output);
  } else {
    if (!node.closed) {
      setStatus(context, path, "missing");
      return { status: "no-match" };
    }
    try {
      candidate = schema["~run"](node.resolvedValue);
    } catch {
      setStatus(context, path, "invalid");
      return { status: "invalid", message: `Invalid ${base.type}` };
    }
  }

  if (isSchemaShape(schema) && hasCheckpoint) {
    const actionResult = applyCheckpointActions(schema, candidate, node.closed);
    if (actionResult.status !== "match") {
      setStatus(
        context,
        path,
        actionResult.status === "invalid"
          ? "invalid"
          : Object.hasOwn(context.prior.values, pathKey(path))
            ? "partial"
            : "missing",
      );
      return actionResult;
    }
    candidate = actionResult.value;
  } else if (node.closed) {
    try {
      candidate = schema["~run"](node.resolvedValue);
    } catch {
      setStatus(context, path, "invalid");
      return { status: "invalid", message: `Invalid ${base.type}` };
    }
  }

  setStatus(context, path, node.closed ? "complete" : "partial");
  return { status: "match", value: reuseValue(context, path, candidate) };
}

/** Resolve the latest parser AST through local streaming checkpoints. */
export function resolveStreamingValue<
  TSchema extends GenericSchema<unknown, unknown>,
>(
  schema: TSchema,
  parser: ParserOperation | ParserState,
  cache: ResolutionCache,
): StreamingResolution<InferStream<TSchema>> {
  const operation = "state" in parser ? parser : { state: parser };
  if (operation.state.error) {
    const nextCache: ResolutionCache = {
      values: cache.values,
      readiness: { ...cache.readiness, [pathKey([])]: "invalid" },
      ...(cache.lastValue === undefined ? {} : { lastValue: cache.lastValue }),
    };
    return {
      status: "invalid",
      error: operation.state.error,
      cache: nextCache,
    };
  }
  const context: ResolveContext = {
    nodes: operation.state.nodes,
    prior: cache,
    values: { ...cache.values },
    statuses: { ...cache.readiness },
  };
  const root =
    operation.state.rootId === null
      ? undefined
      : operation.state.nodes[operation.state.rootId];
  const resolutionSchema = schema as unknown as Schema<unknown, unknown>;
  const result = resolveNode(resolutionSchema, root, [], context);
  const nextCache: ResolutionCache = {
    values: context.values,
    readiness: context.statuses,
    ...(result.status === "match" ? { lastValue: result.value } : {}),
  };
  if (result.status === "no-match")
    return { status: "no-match", cache: nextCache };
  if (result.status === "invalid") {
    return {
      status: "invalid",
      error: { code: "schema_invalid", message: result.message },
      cache: nextCache,
    };
  }
  return {
    status: "match",
    value: result.value as InferStream<TSchema>,
    readiness: { statuses: context.statuses },
    changed: result.value !== cache.lastValue,
    cache: nextCache,
  };
}

/** Read one node status using a type-checked value path. */
export function getStreamStatus<T>(
  readiness: StreamReadiness<T>,
  path: StreamPath<T>,
): StreamNodeStatus {
  return (
    readiness.statuses[pathKey(path as readonly (string | number)[])] ??
    "missing"
  );
}

export type FinalValidationResult<T> =
  | { readonly success: true; readonly value: T }
  | { readonly success: false; readonly issues: readonly unknown[] };

/** Run complete Standard Schema validation against finalized raw JSON. */
export async function validateFinalValue<
  TSchema extends {
    readonly "~standard": {
      readonly validate: (
        value: unknown,
      ) =>
        | { readonly value: unknown }
        | { readonly issues: readonly unknown[] }
        | Promise<
            | { readonly value: unknown }
            | { readonly issues: readonly unknown[] }
          >;
    };
  },
>(
  schema: TSchema,
  parser: ParserOperation | ParserState,
): Promise<
  FinalValidationResult<
    TSchema extends GenericSchema<unknown, infer TOutput> ? TOutput : unknown
  >
> {
  type Output =
    TSchema extends GenericSchema<unknown, infer TOutput> ? TOutput : unknown;
  const operation = "state" in parser ? parser : { state: parser };
  if (operation.state.error) {
    return { success: false, issues: [operation.state.error] };
  }
  const raw = getResolvedValue(operation.state);
  if (raw === undefined) {
    return {
      success: false,
      issues: [{ code: "unexpected_end", message: "JSON is not complete" }],
    };
  }
  const result = await schema["~standard"].validate(raw);
  return "issues" in result
    ? { success: false, issues: result.issues }
    : { success: true, value: result.value as Output };
}

export type { StreamingAction };
