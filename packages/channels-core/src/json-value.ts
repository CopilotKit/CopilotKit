/** Values that retain the same meaning through JSON serialization. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Fixed V0.9 component persistence limits. */
export const COMPONENT_PROPS_MAX_BYTES = 64 * 1024;
export const COMPONENT_STATE_MAX_BYTES = 16 * 1024;
export const COMPONENT_BINDING_MAX_BYTES = 4 * 1024;
export const COMPONENT_BINDINGS_MAX_BYTES = 16 * 1024;

/** Stable details for a component JSON validation or size failure. */
export class JsonValueError extends TypeError {
  readonly code: string;
  readonly path: string;
  readonly limit?: number;
  readonly observed?: number;

  constructor(
    code: string,
    message: string,
    details: { path?: string; limit?: number; observed?: number } = {},
  ) {
    super(message);
    this.name = "JsonValueError";
    this.code = code;
    this.path = details.path ?? "$";
    this.limit = details.limit;
    this.observed = details.observed;
  }
}

export interface JsonValueOptions {
  /** Human-readable value name used in error messages. */
  label: string;
  /** Optional UTF-8 encoded JSON byte ceiling. */
  maxBytes?: number;
  /** Stable error code used when the byte ceiling is exceeded. */
  tooLargeCode?: string;
}

/** Return the UTF-8 encoded byte length of a JSON value. */
export function jsonByteLength(value: JsonValue): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/**
 * Validate that a value is plain, finite, acyclic JSON and enforce an optional
 * encoded-size ceiling without cloning the accepted value.
 */
export function assertJsonValue<T>(
  value: T,
  options: JsonValueOptions,
): T & JsonValue {
  visitJsonValue(value, options.label, "$", new Set<object>());
  const jsonValue = value as T & JsonValue;
  if (options.maxBytes !== undefined) {
    const observed = jsonByteLength(jsonValue);
    if (observed > options.maxBytes) {
      throw new JsonValueError(
        options.tooLargeCode ?? "channel_component_json_too_large",
        `${options.label} is ${observed} bytes; the limit is ${options.maxBytes} bytes.`,
        { limit: options.maxBytes, observed },
      );
    }
  }
  return jsonValue;
}

/**
 * Validate, detach, and deeply freeze a JSON value for an immutable snapshot.
 * The caller's value is never frozen or otherwise changed.
 */
export function snapshotJsonValue<T>(
  value: T,
  options: JsonValueOptions,
): T & JsonValue {
  const validated = assertJsonValue(value, options);
  return cloneAndFreezeJson(validated) as T & JsonValue;
}

/** Validate component props against the fixed 64 KiB limit. */
export function assertComponentProps<T>(value: T): T & JsonValue {
  return assertJsonValue(value, {
    label: "Component props",
    maxBytes: COMPONENT_PROPS_MAX_BYTES,
    tooLargeCode: "channel_component_props_too_large",
  });
}

/** Validate component state against the fixed 16 KiB limit. */
export function assertComponentState<T>(value: T): T & JsonValue {
  return assertJsonValue(value, {
    label: "Component state",
    maxBytes: COMPONENT_STATE_MAX_BYTES,
    tooLargeCode: "channel_component_state_too_large",
  });
}

/** Validate, detach, and freeze component props at the fixed 64 KiB limit. */
export function snapshotComponentProps<T>(value: T): T & JsonValue {
  return snapshotJsonValue(value, {
    label: "Component props",
    maxBytes: COMPONENT_PROPS_MAX_BYTES,
    tooLargeCode: "channel_component_props_too_large",
  });
}

/**
 * Validate and deeply freeze live component props without cloning them.
 * This keeps the schema resolver's stable branch identity between renders;
 * durable stores still detach snapshots before writing.
 */
export function freezeComponentProps<T>(value: T): T & JsonValue {
  const validated = assertComponentProps(value);
  freezeJsonValue(validated);
  return validated;
}

/** Validate, detach, and freeze component state at the fixed 16 KiB limit. */
export function snapshotComponentState<T>(value: T): T & JsonValue {
  return snapshotJsonValue(value, {
    label: "Component state",
    maxBytes: COMPONENT_STATE_MAX_BYTES,
    tooLargeCode: "channel_component_state_too_large",
  });
}

function visitJsonValue(
  value: unknown,
  label: string,
  path: string,
  ancestors: Set<object>,
): void {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw invalidJson(label, path, "numbers must be finite");
  }
  if (typeof value !== "object") {
    throw invalidJson(label, path, `${typeof value} values are not JSON-safe`);
  }
  if (ancestors.has(value)) {
    throw new JsonValueError(
      "channel_component_json_cycle",
      `${label} contains a cycle at ${path}.`,
      { path },
    );
  }

  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  ) {
    throw invalidJson(label, path, "class instances are not JSON-safe");
  }

  ancestors.add(value);
  if (Array.isArray(value)) {
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") continue;
      if (
        typeof key !== "string" ||
        !/^(0|[1-9]\d*)$/.test(key) ||
        Number(key) >= value.length
      ) {
        throw invalidJson(label, path, "array properties are not JSON-safe");
      }
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw invalidJson(
          label,
          `${path}[${index}]`,
          "array holes are not JSON-safe",
        );
      }
      visitJsonValue(value[index], label, `${path}[${index}]`, ancestors);
    }
  } else {
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === "symbol") {
        throw invalidJson(label, path, "symbol keys are not JSON-safe");
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw invalidJson(
          label,
          `${path}.${key}`,
          "hidden properties and accessors are not JSON-safe",
        );
      }
      visitJsonValue(descriptor.value, label, `${path}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
}

function invalidJson(
  label: string,
  path: string,
  reason: string,
): JsonValueError {
  return new JsonValueError(
    "channel_component_json_invalid",
    `${label} is not JSON-safe at ${path}: ${reason}.`,
    { path },
  );
}

function cloneAndFreezeJson(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return Object.freeze(value.map(cloneAndFreezeJson)) as JsonValue[];
  }
  const clone: Record<string, JsonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    Object.defineProperty(clone, key, {
      configurable: false,
      enumerable: true,
      value: cloneAndFreezeJson(child),
      writable: false,
    });
  }
  return Object.freeze(clone);
}

function freezeJsonValue(value: JsonValue): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return;
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    freezeJsonValue(child);
  }
  Object.freeze(value);
}
