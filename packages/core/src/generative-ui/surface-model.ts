/**
 * The state of one generated surface: its data model and its components.
 *
 * These classes replace the state classes of A2UI web_core (0.15) that
 * generative UI used before. They keep their behavior, so the surface
 * manager and the renderers work as before, without web_core, Zod 3 or
 * Preact Signals in the bundle:
 *
 * - Paths are JSON Pointers: `~1` reads as `/`, `~0` as `~`, and empty
 *   segments are ignored ("/a//b/" is "/a/b").
 * - `set` makes the missing containers on its way: an array when the next
 *   segment is an index, else an object. `null` and `undefined` remove the
 *   key (an array index keeps its slot, as `undefined`).
 * - `get` returns the stored value itself, not a copy.
 * - A write notifies the subscribers of its path, of the paths above it and
 *   of the paths below it, when the value at their path changed. An object
 *   or an array always counts as changed; the subscriber gets a shallow copy.
 * - Notifications run after the write is complete. A write made by a
 *   subscriber is notified after the current round of subscribers, and a
 *   subscriber that throws does not stop the others: `set` throws its error
 *   after all of them ran (the batching of Preact Signals, which web_core
 *   used).
 */

/** The largest array index that a write creates or extends to. */
const MAX_ARRAY_INDEX = 10000;

/** Segments that could reach `Object.prototype`. */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** The number of notification rounds after which a write fails. */
const MAX_NOTIFICATION_ROUNDS = 100;

/** An object or array: something a path can go into. */
function isContainer(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isIndex(segment: string) {
  return /^(0|[1-9]\d*)$/.test(segment);
}

function hasOwn(target: object, key: string) {
  return Object.prototype.hasOwnProperty.call(target, key);
}

/** "/a//b/" to "/a/b", escapes kept. The root is "/". */
function normalizePath(path: string) {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

/** The unescaped segments of a JSON Pointer. Throws for a forbidden one. */
function parsePath(path: string): string[] {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((raw) => {
      const segment = raw.replace(/~([01])/g, (_, digit) =>
        digit === "1" ? "/" : "~",
      );
      if (FORBIDDEN_KEYS.has(segment)) {
        throw new Error(
          `Forbidden path segment '${segment}' in path '${path}'.`,
        );
      }
      return segment;
    });
}

function requirePath(path: string | null | undefined): asserts path is string {
  if (path === null || path === undefined) {
    throw new Error("Path cannot be null or undefined.");
  }
}

/** What a subscriber is given: a shallow copy of an object or an array. */
function snapshot(value: unknown) {
  if (Array.isArray(value)) return value.slice();
  if (typeof value === "object" && value !== null) return { ...value };
  return value;
}

/** The last value seen at one path, and the subscribers of that path. */
interface PathState {
  value: unknown;
  watchers: Watcher[];
}

interface Watcher {
  state: PathState;
  onChange: (value: unknown) => void;
  active: boolean;
  queued: boolean;
}

/** A subscription to one path of a `DataModel`. */
export interface DataSubscription {
  unsubscribe(): void;
}

// Shared by every data model, as the batch of Preact Signals was.
let batchDepth = 0;
let round = 0;
let queue: Watcher[] = [];

function enqueue(watcher: Watcher) {
  if (watcher.queued) return;
  watcher.queued = true;
  queue.push(watcher);
}

function batch(write: () => void) {
  batchDepth++;
  try {
    write();
  } finally {
    endBatch();
  }
}

/** Runs the queued subscribers, round after round, once the outer batch ends. */
function endBatch() {
  if (batchDepth > 1) {
    batchDepth--;
    return;
  }
  let error: unknown;
  let hasError = false;
  while (queue.length > 0) {
    const current = queue;
    queue = [];
    round++;
    // Last queued runs first, the order in which Preact runs its effects.
    for (let i = current.length - 1; i >= 0; i--) {
      const watcher = current[i]!;
      watcher.queued = false;
      if (!watcher.active) continue;
      try {
        watcher.onChange(watcher.state.value);
      } catch (thrown) {
        if (!hasError) {
          error = thrown;
          hasError = true;
        }
      }
    }
  }
  round = 0;
  batchDepth--;
  if (hasError) throw error;
}

/**
 * The data model of a surface: a JSON value read and written by JSON
 * Pointer, with subscriptions per path.
 */
export class DataModel {
  private data: unknown;
  /** By normalized path. Kept until `dispose`, as web_core kept its signals. */
  private readonly paths = new Map<string, PathState>();

  /** @param initialData - The value of the root. Defaults to `{}`. */
  constructor(initialData: unknown = {}) {
    this.data = initialData;
  }

  /**
   * The value at `path`, or `undefined` when there is none. "/" or "" is the
   * root. The value is the stored one, not a copy.
   */
  get(path: string): unknown {
    requirePath(path);
    if (path === "/" || path === "") return this.data;
    let current = this.data;
    for (const segment of parsePath(path)) {
      if (!isContainer(current)) return undefined;
      if (Array.isArray(current)) {
        if (!isIndex(segment)) return undefined;
        const index = Number.parseInt(segment, 10);
        if (index >= current.length) return undefined;
        current = current[index];
      } else {
        if (!hasOwn(current, segment)) return undefined;
        current = current[segment];
      }
    }
    return current;
  }

  /**
   * Writes `value` at `path`, making the missing containers on the way, and
   * notifies the subscribers. `null` or `undefined` removes the key; at the
   * root it resets the data to `{}`.
   *
   * @throws Error when a segment is forbidden, when the path goes through a
   *   primitive, uses a non-index segment on an array, or an index above
   *   10000, or when a subscriber throws (after the write).
   */
  set(path: string, value: unknown): this {
    requirePath(path);
    const segments = parsePath(path);
    const last = segments.pop();
    if (last === undefined) {
      this.data = value === null || value === undefined ? {} : value;
      batch(() => {
        for (const key of this.paths.keys()) this.refresh(key);
      });
      return this;
    }
    const removes = value === null || value === undefined;
    if (removes && this.get(path) === undefined) return this;
    if (this.data === null || this.data === undefined) this.data = {};
    const root = this.data;
    if (!isContainer(root)) {
      throw new Error(
        `Cannot set path '${path}': the data model root is a primitive value.`,
      );
    }
    const tooLarge = (segment: string) =>
      new Error(
        `Cannot set path '${path}': array index '${segment}' exceeds maximum supported index (${MAX_ARRAY_INDEX}).`,
      );
    const checkArraySegment = (segment: string) => {
      if (!isIndex(segment)) {
        throw new Error(
          `Cannot use non-numeric segment '${segment}' on an array in path '${path}'.`,
        );
      }
      if (Number.parseInt(segment, 10) > MAX_ARRAY_INDEX) {
        throw tooLarge(segment);
      }
    };
    let current = root;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!;
      const isArray = Array.isArray(current);
      if (isArray) checkArraySegment(segment);
      // Only own keys count: an inherited `toString` is not stored data.
      const child =
        isArray || hasOwn(current, segment) ? current[segment] : undefined;
      if (child === undefined || child === null) {
        const next = i < segments.length - 1 ? segments[i + 1]! : last;
        if (isIndex(next)) {
          if (Number.parseInt(next, 10) > MAX_ARRAY_INDEX) {
            throw tooLarge(next);
          }
          current[segment] = [];
        } else {
          current[segment] = {};
        }
      } else if (typeof child !== "object") {
        throw new Error(
          `Cannot set path '${path}': segment '${segment}' is a primitive value.`,
        );
      }
      const container = current[segment];
      // Unreachable: the branches above made it a container or threw.
      if (!isContainer(container))
        throw new Error(`Cannot set path '${path}'.`);
      current = container;
    }
    if (Array.isArray(current)) {
      checkArraySegment(last);
      if (removes) {
        // Removing past the end does not extend the array.
        const index = Number.parseInt(last, 10);
        if (index < current.length) current[index] = undefined;
      } else {
        current[last] = value;
      }
    } else if (removes) {
      delete current[last];
    } else {
      current[last] = value;
    }
    this.notify(path);
    return this;
  }

  /**
   * Calls `onChange` with the new value when the value at `path` changes:
   * after a write at `path`, above it or below it. It is not called with
   * the current value.
   */
  subscribe(
    path: string,
    onChange: (value: unknown) => void,
  ): DataSubscription {
    const key = normalizePath(path);
    let state = this.paths.get(key);
    if (!state) {
      state = { value: this.get(key), watchers: [] };
      this.paths.set(key, state);
    }
    const watcher: Watcher = { state, onChange, active: true, queued: false };
    state.watchers.push(watcher);
    return {
      unsubscribe: () => {
        watcher.active = false;
        const index = watcher.state.watchers.indexOf(watcher);
        if (index !== -1) watcher.state.watchers.splice(index, 1);
      },
    };
  }

  /** Ends every subscription. The data stays. */
  dispose() {
    for (const state of this.paths.values()) {
      for (const watcher of state.watchers) watcher.active = false;
      state.watchers = [];
    }
    this.paths.clear();
  }

  /** Refreshes `path`, the paths above it and the paths below it. */
  private notify(path: string) {
    const key = normalizePath(path);
    batch(() => {
      this.refresh(key);
      let parent = key;
      while (parent !== "/") {
        parent = parent.slice(0, parent.lastIndexOf("/")) || "/";
        this.refresh(parent);
      }
      for (const other of this.paths.keys()) {
        if (other.startsWith(`${key}/`)) this.refresh(other);
      }
    });
  }

  /** Queues the subscribers of `key` when its value changed. */
  private refresh(key: string) {
    const state = this.paths.get(key);
    if (!state) return;
    const next = snapshot(this.get(key));
    if (next === state.value) return;
    if (round > MAX_NOTIFICATION_ROUNDS) throw new Error("Cycle detected");
    state.value = next;
    // Newest first, so that the reversed queue runs them oldest first.
    for (let i = state.watchers.length - 1; i >= 0; i--) {
      enqueue(state.watchers[i]!);
    }
  }
}

/** One component of a surface. */
export class ComponentModel {
  readonly id: string;
  /** The component name, for example "Text". */
  readonly type: string;
  /** The node without `id` and `component`. Replaced on update. */
  properties: Record<string, unknown>;

  constructor(id: string, type: string, properties: Record<string, unknown>) {
    this.id = id;
    this.type = type;
    this.properties = properties;
  }
}

/** The components of a surface, by id, in the order they were added. */
export class SurfaceComponentsModel {
  private readonly components = new Map<string, ComponentModel>();

  get(id: string): ComponentModel | undefined {
    return this.components.get(id);
  }

  get entries(): IterableIterator<[string, ComponentModel]> {
    return this.components.entries();
  }

  /** @throws Error when a component with the same id is there. */
  addComponent(component: ComponentModel) {
    if (this.components.has(component.id)) {
      throw new Error(`Component with id '${component.id}' already exists.`);
    }
    this.components.set(component.id, component);
  }

  removeComponent(id: string) {
    this.components.delete(id);
  }

  dispose() {
    this.components.clear();
  }
}

/** The state of one surface. */
export class SurfaceModel {
  readonly dataModel = new DataModel();
  readonly componentsModel = new SurfaceComponentsModel();

  constructor(readonly id: string) {}

  /** Ends the data subscriptions and drops the components. */
  dispose() {
    this.dataModel.dispose();
    this.componentsModel.dispose();
  }
}
