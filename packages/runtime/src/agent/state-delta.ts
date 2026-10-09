import type {
  BaseEvent,
  StateDeltaEvent,
  StateSnapshotEvent,
} from "@ag-ui/client";
import { EventType } from "@ag-ui/client";

type StateDeltaOperation = {
  op?: string;
  path?: string;
  from?: string;
  value?: unknown;
};

type PointerResult = {
  exists: boolean;
  value?: unknown;
};

type OperationResult = {
  root: unknown;
  applied: boolean;
};

function parseJsonPointer(pointer: string): string[] | undefined {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) return undefined;

  const segments = pointer.slice(1).split("/");
  if (segments.some((segment) => /~(?![01])/.test(segment))) {
    return undefined;
  }

  return segments.map((segment) =>
    segment.replace(/~1/g, "/").replace(/~0/g, "~"),
  );
}

function encodeJsonPointer(segments: string[]): string {
  if (segments.length === 0) return "";
  return `/${segments
    .map((segment) => segment.replace(/~/g, "~0").replace(/\//g, "~1"))
    .join("/")}`;
}

function getArrayIndex(segment: string, length: number): number | undefined {
  if (segment !== "0" && !/^[1-9]\d*$/.test(segment)) return undefined;
  const index = Number(segment);
  return Number.isSafeInteger(index) && index < length ? index : undefined;
}

function getJsonPointerValue(root: unknown, pointer: string): PointerResult {
  const segments = parseJsonPointer(pointer);
  if (segments === undefined) return { exists: false };

  let current = root;
  for (const segment of segments) {
    if (current === null || typeof current !== "object") {
      return { exists: false };
    }

    if (Array.isArray(current)) {
      const index = getArrayIndex(segment, current.length);
      if (index === undefined) return { exists: false };
      current = current[index];
    } else {
      if (!Object.prototype.hasOwnProperty.call(current, segment)) {
        return { exists: false };
      }
      current = (current as Record<string, unknown>)[segment];
    }
  }

  return { exists: true, value: current };
}

function getParent(root: unknown, segments: string[]): PointerResult {
  return getJsonPointerValue(root, encodeJsonPointer(segments.slice(0, -1)));
}

function cloneStateFallback(
  state: unknown,
  seen = new WeakMap<object, unknown>(),
): unknown {
  if (state === null || typeof state !== "object") return state;

  const existing = seen.get(state);
  if (existing !== undefined) return existing;

  let clone: object;
  try {
    clone = Array.isArray(state)
      ? []
      : Object.create(Object.getPrototypeOf(state));
  } catch {
    clone = Array.isArray(state) ? [] : {};
  }
  seen.set(state, clone);

  let keys: (string | symbol)[] = [];
  try {
    keys = Reflect.ownKeys(state);
  } catch {
    return clone;
  }

  for (const key of keys) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(state, key);
      if (!descriptor) continue;
      if ("value" in descriptor) {
        descriptor.value = cloneStateFallback(descriptor.value, seen);
      }
      Object.defineProperty(clone, key, descriptor);
    } catch {
      // Keep the cloned container distinct when a property is inaccessible.
    }
  }

  return clone;
}

function cloneState(state: unknown): unknown {
  try {
    return structuredClone(state);
  } catch {
    return cloneStateFallback(state);
  }
}

function addValue(
  root: unknown,
  segments: string[],
  value: unknown,
): OperationResult {
  if (segments.length === 0) {
    return { root: cloneState(value), applied: true };
  }

  const parent = getParent(root, segments);
  if (
    !parent.exists ||
    parent.value === null ||
    typeof parent.value !== "object"
  ) {
    return { root, applied: false };
  }

  const segment = segments[segments.length - 1];
  if (Array.isArray(parent.value)) {
    if (segment === "-") {
      parent.value.push(cloneState(value));
      return { root, applied: true };
    }

    const index =
      segment === "0"
        ? 0
        : /^[1-9]\d*$/.test(segment)
          ? Number(segment)
          : undefined;
    if (
      index === undefined ||
      !Number.isSafeInteger(index) ||
      index > parent.value.length
    ) {
      return { root, applied: false };
    }
    parent.value.splice(index, 0, cloneState(value));
    return { root, applied: true };
  }

  (parent.value as Record<string, unknown>)[segment] = cloneState(value);
  return { root, applied: true };
}

function removeValue(root: unknown, segments: string[]): OperationResult {
  if (segments.length === 0) return { root: undefined, applied: true };

  const parent = getParent(root, segments);
  if (
    !parent.exists ||
    parent.value === null ||
    typeof parent.value !== "object"
  ) {
    return { root, applied: false };
  }

  const segment = segments[segments.length - 1];
  if (Array.isArray(parent.value)) {
    const index = getArrayIndex(segment, parent.value.length);
    if (index === undefined) return { root, applied: false };
    parent.value.splice(index, 1);
    return { root, applied: true };
  }

  if (!Object.prototype.hasOwnProperty.call(parent.value, segment)) {
    return { root, applied: false };
  }
  delete (parent.value as Record<string, unknown>)[segment];
  return { root, applied: true };
}

function replaceValue(
  root: unknown,
  segments: string[],
  value: unknown,
): OperationResult {
  if (segments.length === 0) {
    return { root: cloneState(value), applied: true };
  }

  const parent = getParent(root, segments);
  if (
    !parent.exists ||
    parent.value === null ||
    typeof parent.value !== "object"
  ) {
    return { root, applied: false };
  }

  const segment = segments[segments.length - 1];
  if (Array.isArray(parent.value)) {
    const index = getArrayIndex(segment, parent.value.length);
    if (index === undefined) return { root, applied: false };
    parent.value[index] = cloneState(value);
    return { root, applied: true };
  }

  if (!Object.prototype.hasOwnProperty.call(parent.value, segment)) {
    return { root, applied: false };
  }
  (parent.value as Record<string, unknown>)[segment] = cloneState(value);
  return { root, applied: true };
}

function jsonValueEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  if (Array.isArray(left) !== Array.isArray(right)) return false;

  const leftKeys = Object.keys(left as object);
  const rightKeys = Object.keys(right as object);
  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(right, key) &&
      jsonValueEqual(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
      ),
  );
}

function applyStateDeltaOperation(
  root: unknown,
  operation: StateDeltaOperation,
): OperationResult {
  if (typeof operation.path !== "string") return { root, applied: false };

  const path = parseJsonPointer(operation.path);
  if (path === undefined) return { root, applied: false };

  switch (operation.op) {
    case "add":
      return addValue(root, path, operation.value);
    case "remove":
      return removeValue(root, path);
    case "replace":
      return replaceValue(root, path, operation.value);
    case "test": {
      const actual = getJsonPointerValue(root, operation.path);
      return {
        root,
        applied: actual.exists && jsonValueEqual(actual.value, operation.value),
      };
    }
    case "copy": {
      if (typeof operation.from !== "string") return { root, applied: false };
      const source = getJsonPointerValue(root, operation.from);
      if (!source.exists) return { root, applied: false };
      return addValue(root, path, source.value);
    }
    case "move": {
      if (typeof operation.from !== "string") return { root, applied: false };
      const from = parseJsonPointer(operation.from);
      if (from === undefined) return { root, applied: false };
      const source = getJsonPointerValue(root, operation.from);
      if (!source.exists) return { root, applied: false };
      if (operation.from === operation.path) return { root, applied: true };

      const nextRoot = cloneState(root);
      const removed = removeValue(nextRoot, from);
      if (!removed.applied) return { root, applied: false };
      const added = addValue(removed.root, path, source.value);
      return added.applied ? added : { root, applied: false };
    }
    default:
      return { root, applied: false };
  }
}

function normalizeStateDelta(
  delta: unknown[],
  initialState: unknown,
): { delta: unknown[]; state: unknown } {
  let state = cloneState(initialState);
  const normalized: unknown[] = [];

  for (const operation of delta) {
    const candidate =
      operation !== null && typeof operation === "object"
        ? (operation as StateDeltaOperation)
        : undefined;
    if (
      candidate?.op === "add" &&
      typeof candidate.path === "string" &&
      candidate.path.endsWith("/-")
    ) {
      const arrayPath = candidate.path.slice(0, -2);
      const array = getJsonPointerValue(state, arrayPath);
      if (!array.exists) {
        const lastSlash = arrayPath.lastIndexOf("/");
        const parentPath = lastSlash > 0 ? arrayPath.slice(0, lastSlash) : "";
        if (getJsonPointerValue(state, parentPath).exists) {
          const initializer: StateDeltaOperation = {
            op: "add",
            path: arrayPath,
            value: [],
          };
          const applied = applyStateDeltaOperation(state, initializer);
          if (applied.applied) {
            normalized.push(initializer);
            state = applied.root;
          }
        }
      }
    }

    normalized.push(operation);
    if (candidate) {
      const applied = applyStateDeltaOperation(state, candidate);
      if (applied.applied) state = applied.root;
    }
  }

  return { delta: normalized, state };
}

export function createStateEventNormalizer(
  initialState: unknown,
): (event: BaseEvent) => BaseEvent[] {
  let state = cloneState(initialState);
  let hasEmittedState = false;

  return (event) => {
    if (event.type === EventType.STATE_SNAPSHOT) {
      state = cloneState((event as StateSnapshotEvent).snapshot);
      hasEmittedState = true;
      return [event];
    }

    if (event.type !== EventType.STATE_DELTA) return [event];

    const stateDeltaEvent = event as StateDeltaEvent;
    const initialSnapshot: StateSnapshotEvent[] =
      !hasEmittedState && initialState !== undefined
        ? [
            {
              type: EventType.STATE_SNAPSHOT,
              snapshot: cloneState(state),
            },
          ]
        : [];
    const normalized = Array.isArray(stateDeltaEvent.delta)
      ? normalizeStateDelta(stateDeltaEvent.delta, state)
      : { delta: stateDeltaEvent.delta, state };
    state = normalized.state;
    hasEmittedState = true;

    return [
      ...initialSnapshot,
      {
        ...stateDeltaEvent,
        delta: normalized.delta as StateDeltaEvent["delta"],
      },
    ];
  };
}
