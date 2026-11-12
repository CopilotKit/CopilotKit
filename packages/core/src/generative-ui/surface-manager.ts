import { containsDynamicValue } from "./resolve";
import { ComponentModel, DataModel, SurfaceModel } from "./surface-model";
import {
  A2UI_COMPONENT_ENVELOPE_KEYS,
  cloneValue,
  GENERATIVE_UI_MAX_REJECTION_LENGTH,
  GENERATIVE_UI_MAX_SUMMARY_REJECTIONS,
  getOperationKind,
  getOperationSurfaceId,
  validateOperation,
} from "@copilotkit/shared";
import type {
  A2UIComponentNode,
  A2UIOperation,
  GenerativeUIRejectedOperation,
  GenerativeUISurfaceContent,
  GenerativeUISurfaceStatus,
  GenerativeUISurfaceSummary,
  OperationKind,
} from "@copilotkit/shared";
import { catalogIdsOf, hasOwnKey } from "@copilotkit/shared/generative-ui";
import type { GenerativeUI } from "@copilotkit/shared/generative-ui";
import {
  formatIssues,
  isAsyncIssue,
  issueKey,
  validateSchemaSync,
  withoutRejectedNulls,
} from "@copilotkit/shared/generative-ui";

export function surfaceKey(threadId: string, surfaceId: string): string {
  return `${threadId}::${surfaceId}`;
}

export interface ManagedSurface {
  readonly key: string;
  readonly threadId: string;
  readonly surfaceId: string;
  readonly agentId: string | undefined;
  /** Replaced by an empty model when the surface closes, to free its data. */
  model: SurfaceModel;
  readonly createdAt: number;
  target: string;
  status: GenerativeUISurfaceStatus;
  deleted: boolean;
  /** Its first createSurface was rejected, so it never existed. */
  failed: boolean;
  /** Rejections reported by the runtime. */
  serverRejected: GenerativeUIRejectedOperation[];
  /** Rejections detected while applying operations in the browser. */
  clientRejected: GenerativeUIRejectedOperation[];
  /** The committed operations of the latest content, for the inspector. */
  operations: readonly A2UIOperation[];
  /**
   * `"0.9"` when the runtime converted the surface from A2UI v0.9, from the
   * latest content. The surface summary sends it to the runtime.
   */
  a2uiSourceVersion?: "0.9";
}

export interface GenerativeUISurfaceManagerOptions {
  onOperationRejected?: (info: {
    surfaceId: string;
    index: number;
    reason: string;
  }) => void;
}

/** Where an operation is in the content of its surface. */
interface OperationPosition {
  index: number;
  /** The content also deletes the surface, so it replays all of its life. */
  isReplay: boolean;
}

interface Bookkeeping {
  appliedCount: number;
  lastFingerprint: string | undefined;
}

/** What one mount of a target tells the model. */
export interface GenerativeUITargetOptions {
  /** Where the target is on the page and what to show in it. */
  description?: string;
  /**
   * The only components that the surfaces of the target can use. Left out,
   * every component of the UI is allowed.
   */
  components?: readonly string[];
}

/** One mount of a target. Each mount gets its own object. */
type TargetRegistration = Readonly<GenerativeUITargetOptions>;

/** A mounted target, as the manifest lists it. */
export interface GenerativeUIMountedTarget {
  id: string;
  description?: string;
  components?: string[];
}

let creationCounter = 0;

/** `"0.9"` for content that the runtime converted from A2UI v0.9. */
function sourceVersionOf(content: GenerativeUISurfaceContent) {
  return content.a2uiSourceVersion === "0.9" ? ("0.9" as const) : undefined;
}

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

/** "/a/b/" to "/a/b". The root stays "/". */
function normalizePath(path: string) {
  const trimmed =
    path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  return trimmed || "/";
}

/** A user-owned value, and what the agent is told about it. */
interface OwnedValue {
  /**
   * A copy with structuredClone semantics, as the data model holds it. It is
   * never changed or handed out (each read copies it), so linked surfaces
   * share one.
   */
  value: unknown;
  /**
   * `JSON.stringify` of `value`, which the description of the surface
   * parses, so every request gets a fresh copy. `undefined` when JSON
   * refuses the value (a bigint or a cycle): the agent is not told it.
   */
  json: string | undefined;
}

/**
 * What the agent is told about a user value: what `JSON.stringify` makes
 * of it, as before generative UI ran on React Native. `NaN` and `Infinity`
 * become `null`, a valid `Date` its ISO string (an invalid one `null`), a
 * `Map` or a `Set` `{}`, and an `undefined` member is dropped. A value JSON refuses (a bigint or a cycle)
 * would make building the request throw, so it is left out of the
 * description instead, with a `console.warn`. It stays in the data model.
 */
/** The JSON of an operation, or undefined when JSON refuses it. */
function fingerprint(operation: unknown): string | undefined {
  try {
    return JSON.stringify(operation);
  } catch {
    return undefined;
  }
}

/** Whether two rejection lists hold the same entries in the same order. */
function sameRejected(
  a: readonly GenerativeUIRejectedOperation[],
  b: readonly GenerativeUIRejectedOperation[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (entry, i) =>
        entry.index === b[i]!.index && entry.reason === b[i]!.reason,
    )
  );
}

function agentJson(value: unknown, path: string): string | undefined {
  try {
    return JSON.stringify(value) ?? "null";
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    console.warn(
      `[generativeUI] the value written to "${path}" is kept in the data model, but the agent is not told it, because JSON cannot hold it (${reason}). Write strings, numbers, booleans, null, arrays, plain objects or dates.`,
    );
    return undefined;
  }
}

/**
 * Defines `key` on `target` as a copy of what `read` gives, made the first
 * time it is read and then kept, so a value nobody reads is never copied.
 * The property is enumerable, and assigning it replaces the copy.
 */
function defineCopyOnRead(
  target: object,
  key: string,
  read: () => unknown,
): void {
  const settle = (value: unknown) => {
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    return value;
  };
  Object.defineProperty(target, key, {
    enumerable: true,
    configurable: true,
    get: () => settle(cloneValue(read())),
    set: settle,
  });
}

/** True when `path` is `ancestor` or below it. */
function isAtOrBelow(path: string, ancestor: string) {
  if (ancestor === "/") return true;
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

/**
 * Rejections as `"operation <index>: <reason>"` lines, cut to the size that
 * the envelope reader accepts.
 */
function summarizeRejections(rejections: GenerativeUIRejectedOperation[]) {
  return rejections
    .slice(0, GENERATIVE_UI_MAX_SUMMARY_REJECTIONS)
    .map(({ index, reason }) =>
      `operation ${index}: ${reason}`.slice(
        0,
        GENERATIVE_UI_MAX_REJECTION_LENGTH,
      ),
    );
}

/**
 * Framework-agnostic store of generated surfaces. One SurfaceModel per
 * (threadId, surfaceId), shared by every mount. Applies only newly committed
 * operations, validates each before applying it, and owns app state and the
 * data model paths that the user wrote, so agent updates cannot overwrite
 * them. App state never goes into a surface's data model. Selectors read it
 * with `getState()`.
 */
export class GenerativeUISurfaceManager {
  private readonly surfaces = new Map<string, ManagedSurface>();
  private readonly bookkeeping = new Map<string, Bookkeeping>();
  private readonly listeners = new Set<() => void>();
  /** Mounts of each target id, in mount order. */
  private readonly targets = new Map<string, Set<TargetRegistration>>();
  private state: Readonly<Record<string, unknown>> = {};
  /**
   * User-owned data model values, by surface key, then by path. Kept when a
   * surface is rebuilt. Cleared when the surface is deleted.
   */
  private readonly owned = new Map<string, Map<string, OwnedValue>>();
  /**
   * Keys of the surfaces that a `deleteSurface` removed. A surface id is
   * unique for the life of the page, so a key stays here when its surface is
   * built again.
   */
  private readonly deletedKeys = new Set<string>();
  /**
   * Surfaces that share their data model, by surface key: the parts of a
   * chat surface that the prose lift split. A user write to one part goes
   * to every part, so an input in one part drives a binding in another.
   */
  private readonly linked = new Map<string, ReadonlySet<string>>();
  private activeThreadId: string | undefined;
  private version = 0;

  constructor(
    private readonly ui: GenerativeUI,
    private readonly options: GenerativeUISurfaceManagerOptions = {},
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = (): number => this.version;

  private notify() {
    this.version++;
    for (const listener of [...this.listeners]) listener();
  }

  setActiveThread(threadId: string | undefined) {
    if (threadId === this.activeThreadId) return;
    this.activeThreadId = threadId;
    this.notify();
  }

  getActiveThread(): string | undefined {
    return this.activeThreadId;
  }

  ingest(
    threadId: string,
    agentId: string | undefined,
    content: GenerativeUISurfaceContent,
  ): void {
    const key = surfaceKey(threadId, content.surfaceId);
    const operations = content.operations ?? [];
    let surface = this.surfaces.get(key);
    let book = this.bookkeeping.get(key);
    let changed = false;
    const extendsApplied =
      !!surface && !!book && this.extendsApplied(book, operations);
    // Check every operation this ingest would apply, before changing
    // anything: content with an operation that JSON refuses (a bigint, a
    // cycle) cannot come from the wire, and is skipped whole, so ingest
    // never throws and never applies part of it. Only the new operations
    // are checked; the applied ones passed when they were new. The last
    // one is fingerprinted pristine, before it is applied.
    const start = extendsApplied ? book!.appliedCount : 0;
    for (let index = start; index < operations.length - 1; index++) {
      if (fingerprint(operations[index]) === undefined) return;
    }
    const lastFingerprint =
      operations.length > 0
        ? fingerprint(operations[operations.length - 1])
        : undefined;
    if (operations.length > 0 && lastFingerprint === undefined) return;

    if (surface && book && !extendsApplied) {
      this.disposeSurface(key);
      surface = undefined;
      book = undefined;
    }
    if (!surface || !book) {
      surface = this.createSurface(key, threadId, agentId, content);
      this.restoreOwnedValues(surface);
      book = { appliedCount: 0, lastFingerprint: undefined };
      this.surfaces.set(key, surface);
      this.bookkeeping.set(key, book);
      changed = true;
    }
    const serverRejected = content.rejected ?? [];
    // Client rejections describe the latest render_ui call only, like the
    // server's `rejected` list. The runtime starts each call on an existing
    // surface by flipping status back to "streaming" and resetting `rejected`
    // to [], so either signal clears them before this ingest's new operations
    // are applied. A rebuild starts empty; since call boundaries are not on the
    // wire, replaying every operation then re-reports earlier calls' rejections.
    if (
      surface.clientRejected.length > 0 &&
      ((surface.status !== "streaming" && content.status === "streaming") ||
        serverRejected.length < surface.serverRejected.length)
    ) {
      surface.clientRejected = [];
      changed = true;
    }
    if (operations.length > 0) {
      // Content that also deletes the surface replays all of its life, for
      // example when the markdown source builds a surface again. Its
      // createSurface is not a new create.
      const isReplay = operations.some(
        (op) => getOperationKind(op) === "deleteSurface",
      );
      for (let index = book.appliedCount; index < operations.length; index++) {
        this.applyOperation(surface, operations[index], { index, isReplay });
        changed = true;
      }
      book.appliedCount = operations.length;
      surface.operations = operations;
      book.lastFingerprint = lastFingerprint;
    }
    if (
      surface.status !== content.status ||
      surface.target !== content.target ||
      !sameRejected(surface.serverRejected, serverRejected)
    ) {
      surface.status = content.status;
      surface.target = content.target;
      surface.serverRejected = serverRejected;
      changed = true;
    }
    // Only the summary for the runtime reads it, so a change does not notify.
    surface.a2uiSourceVersion = sourceVersionOf(content);
    if (changed) this.notify();
  }

  /** The surface of a `key` (see `surfaceKey`), unless it is deleted. */
  getSurfaceByKey(key: string): ManagedSurface | undefined {
    const surface = this.surfaces.get(key);
    return surface && !surface.deleted ? surface : undefined;
  }

  getSurface(threadId: string, surfaceId: string): ManagedSurface | undefined {
    const surface = this.surfaces.get(surfaceKey(threadId, surfaceId));
    return surface && !surface.deleted ? surface : undefined;
  }

  getSurfaceForTarget(
    target: string,
    threadId: string | undefined = this.activeThreadId,
  ): ManagedSurface | undefined {
    if (!threadId) return undefined;
    let latest: ManagedSurface | undefined;
    for (const surface of this.surfaces.values()) {
      if (
        surface.threadId !== threadId ||
        surface.target !== target ||
        surface.deleted
      )
        continue;
      if (!latest || surface.createdAt > latest.createdAt) latest = surface;
    }
    return latest;
  }

  /**
   * A surface whose first createSurface was rejected, so the chat can show
   * the error where the surface would be. `undefined` for any other surface.
   */
  getFailedSurface(
    threadId: string,
    surfaceId: string,
  ): ManagedSurface | undefined {
    const surface = this.surfaces.get(surfaceKey(threadId, surfaceId));
    return surface?.failed ? surface : undefined;
  }

  /**
   * The surfaces of a thread, for the model. A surface with user-owned
   * values lists them in `dataModel`, so the model can read what the user
   * entered. A surface with dropped operations lists them in `rejected`, so
   * the model can fix them on the next run. A deleted surface, or one that
   * was never created, has a `status`, so the model knows that the id is
   * not a live surface.
   */
  describeSurfaces(threadId: string) {
    const described: Record<string, GenerativeUISurfaceSummary> = {};
    for (const surface of this.surfaces.values()) {
      if (surface.threadId !== threadId) continue;
      const owned = this.owned.get(surface.key);
      const rejections = [...surface.serverRejected, ...surface.clientRejected];
      // ponytail: a deleted surface stays listed for the life of the thread, one short line each. Prune the oldest when long threads make the envelope too big.
      // A deleted id stays deleted, also when a later createSurface used it
      // again and failed: it can never be used again.
      const status = this.deletedKeys.has(surface.key)
        ? "deleted"
        : surface.failed
          ? "failed"
          : undefined;
      // What JSON.stringify makes of each user value, parsed, so the
      // description is JSON and shares no object with the owned values.
      const dataModel: Record<string, unknown> = {};
      for (const [path, { json }] of owned ?? []) {
        if (json !== undefined) dataModel[path] = JSON.parse(json);
      }
      described[surface.surfaceId] = {
        target: surface.target,
        ...(Object.keys(dataModel).length > 0 ? { dataModel } : {}),
        ...(rejections.length > 0 && status !== "deleted"
          ? { rejected: summarizeRejections(rejections) }
          : {}),
        ...(status ? { status } : {}),
        ...(surface.a2uiSourceVersion
          ? { a2uiSourceVersion: surface.a2uiSourceVersion }
          : {}),
      };
    }
    return described;
  }

  /**
   * Every surface that is not deleted, oldest first, for the inspector. The
   * data model and the user values are copies, so the inspector cannot
   * change the surface through them. The inspector asks for this on every
   * change of the manager, so each copy is made only the first time it is
   * read (then kept): a snapshot that nobody opens copies nothing. The user
   * values are those of the call; the data model is the one of the first
   * read, which the inspector does while it renders the snapshot.
   */
  debugSurfaces() {
    return [...this.surfaces.values()]
      .filter((surface) => !surface.deleted)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((surface) => {
        const { model } = surface;
        const owned = [...(this.owned.get(surface.key) ?? [])];
        const entry = {
          surfaceId: surface.surfaceId,
          threadId: surface.threadId,
          agentId: surface.agentId,
          target: surface.target,
          status: surface.status,
          operations: surface.operations,
          rejected: [
            ...surface.serverRejected.map((r) => ({
              ...r,
              source: "runtime" as const,
            })),
            ...surface.clientRejected.map((r) => ({
              ...r,
              source: "browser" as const,
            })),
          ],
        } as {
          surfaceId: string;
          threadId: string;
          agentId: string | undefined;
          target: string;
          status: ManagedSurface["status"];
          operations: ManagedSurface["operations"];
          dataModel: unknown;
          userValues: Record<string, unknown>;
          rejected: Array<
            GenerativeUIRejectedOperation & { source: "runtime" | "browser" }
          >;
        };
        defineCopyOnRead(entry, "dataModel", () => model.dataModel.get("/"));
        defineCopyOnRead(entry, "userValues", () =>
          Object.fromEntries(owned.map(([path, { value }]) => [path, value])),
        );
        return entry;
      });
  }

  /**
   * Marks a target as mounted. Returns the function that unmounts it. Calling
   * that function more than once has no effect.
   *
   * @param id - The target id.
   * @param options - The description and the allowed components of this mount.
   */
  registerTarget(id: string, options: GenerativeUITargetOptions = {}) {
    const registration: TargetRegistration = { ...options };
    const registrations = this.targets.get(id) ?? new Set();
    registrations.add(registration);
    this.targets.set(id, registrations);
    this.notify();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      registrations.delete(registration);
      if (registrations.size === 0) this.targets.delete(id);
      this.notify();
    };
  }

  /**
   * The mounted targets. Each has the description and the component list of
   * its earliest mount that has one.
   */
  getMountedTargets() {
    const mounted: GenerativeUIMountedTarget[] = [];
    for (const [id, registrations] of this.targets) {
      // ponytail: when mounts of one id have different descriptions, the earliest mount that is still mounted and has a description wins. A mount without a description does not hide the description of a later mount.
      const description = [...registrations].find(
        (registration) => registration.description !== undefined,
      )?.description;
      const components = this.targetComponents(id);
      mounted.push({
        id,
        ...(description === undefined ? {} : { description }),
        ...(components === undefined ? {} : { components: [...components] }),
      });
    }
    return mounted;
  }

  /**
   * The component list of the earliest mount of `id` that has one.
   * `undefined` when no mount of `id` limits its components.
   */
  private targetComponents(id: string) {
    const registrations = this.targets.get(id) ?? new Set<TargetRegistration>();
    return [...registrations].find(
      (registration) => registration.components !== undefined,
    )?.components;
  }

  /** The components that `validateOperation` allows on a surface. */
  private allowedComponentsFor(surface: ManagedSurface) {
    const components = this.targetComponents(surface.target);
    return components === undefined
      ? undefined
      : { target: surface.target, names: new Set(components) };
  }

  /**
   * The app state object. It is the same object until a key changes, so it
   * can be a `useSyncExternalStore` snapshot.
   */
  getState = () => this.state;

  /** Sets one state key. Notifies only when the value changed. */
  setState(key: string, value: unknown) {
    const isUnchanged =
      hasOwnKey(this.state, key) && Object.is(this.state[key], value);
    if (isUnchanged) return;
    this.state = { ...this.state, [key]: value };
    this.notify();
  }

  /** Removes one state key. Notifies only when the key was set. */
  removeState(key: string) {
    if (!hasOwnKey(this.state, key)) return;
    const { [key]: _removed, ...rest } = this.state;
    this.state = rest;
    this.notify();
  }

  /**
   * Makes the surfaces of `surfaceIds` share their data model: a user write
   * to one of them goes to all of them (see `setOwnedValue`). The markdown
   * transport links the parts of a chat surface that the prose lift split.
   * A later call for one of the surfaces replaces its group.
   *
   * @param threadId - The thread of the surfaces.
   * @param surfaceIds - The surface ids of the group. One id clears a link.
   */
  linkSurfaces(threadId: string, surfaceIds: readonly string[]) {
    const keys = new Set(surfaceIds.map((id) => surfaceKey(threadId, id)));
    for (const key of keys) {
      if (keys.size > 1) this.linked.set(key, keys);
      else this.linked.delete(key);
    }
  }

  /**
   * Writes a user value into the data model of a surface, and marks `path`
   * as user-owned. Then agent writes to that path, or below it, are ignored.
   * An agent write above it keeps the user value. Ownership ends when the
   * surface is deleted. Does nothing for an unknown or deleted surface with
   * no live linked surface, and then does not check `value` either. The
   * surfaces linked to it (see `linkSurfaces`) get the same write.
   *
   * @param key - The `key` of the surface.
   * @param path - An absolute JSON pointer, for example "/form/email".
   * @param value - The new value. It is copied with structuredClone
   *   semantics, so the data model never shares an object with it, and it
   *   keeps what structuredClone keeps: `NaN`, `Infinity`, `-0`, a `Date`,
   *   a `Map`, a `Set`; a class instance becomes a plain object. The agent
   *   reads it from the JSON request of the next run, so it is told what
   *   `JSON.stringify` makes of it (`NaN` becomes `null`, a valid `Date`
   *   its ISO string, an invalid one `null`, a `Map` `{}`). A value JSON refuses (a bigint, a cycle) is
   *   written, but left out of what the agent is told, with a
   *   `console.warn`. `null` or `undefined` removes the key, as an agent
   *   `null` does; the path stays user-owned, and the agent is told `null`
   *   for it, which the protocol reads as "removed".
   * @throws An error named "DataCloneError" when structuredClone refuses
   *   `value`: a function, a symbol, a `WeakMap`, a `Promise`... It is
   *   checked before any surface is written, so nothing is written. The
   *   framework setters report it with `reportError`.
   * @throws Error when a path segment is "__proto__", "constructor" or
   *   "prototype", or when the path does not fit the data (for example, a
   *   segment above it holds a string).
   */
  setOwnedValue(key: string, path: string, value: unknown): void {
    const normalized = normalizePath(path);
    const segments = normalized.split("/");
    const forbidden = segments.find((segment) =>
      FORBIDDEN_SEGMENTS.has(segment),
    );
    if (forbidden !== undefined) {
      throw new Error(
        `[generativeUI] path segment "${forbidden}" is not allowed in "${path}".`,
      );
    }
    // `undefined` is stored as `null`: both remove the key, and the agent
    // is told `null`. A value that cannot be cloned throws here, before
    // any surface is written. This one copy is the owned value of every
    // linked surface: it is never changed or handed out (each read copies
    // it), so they can share it. Each data model gets a copy of its own,
    // so 1 + N copies for N linked surfaces.
    const targets = [...(this.linked.get(key) ?? [key])].filter((target) => {
      const surface = this.surfaces.get(target);
      return surface !== undefined && !surface.deleted;
    });
    if (targets.length === 0) return;
    const owned = value === undefined ? null : cloneValue(value);
    const json = agentJson(owned, normalized);
    for (const target of targets) {
      this.writeOwnedValue(target, normalized, { value: owned, json });
    }
  }

  /** Writes `owned`, which `setOwnedValue` made, as a user-owned value. */
  private writeOwnedValue(key: string, path: string, owned: OwnedValue) {
    const surface = this.surfaces.get(key);
    if (!surface || surface.deleted) return;
    // A `null` removes the key (the v1.0 protocol).
    surface.model.dataModel.set(path, cloneValue(owned.value));
    const values = this.owned.get(key) ?? new Map<string, OwnedValue>();
    values.set(path, owned);
    this.owned.set(key, values);
  }

  /**
   * Writes the user-owned values into the new, empty data model of a rebuilt
   * surface. The agent operations are applied after it.
   */
  private restoreOwnedValues(surface: ManagedSurface) {
    const owned = this.owned.get(surface.key) ?? new Map<string, OwnedValue>();
    for (const [path, { value }] of owned) {
      surface.model.dataModel.set(path, cloneValue(value));
    }
  }

  /**
   * The value that an agent write puts at `path`, with the user-owned values
   * below `path` written back into it. `undefined` when `path` is user-owned
   * or below a user-owned path, so the agent cannot write it. Throws when a
   * user value does not fit the new value.
   */
  private mergeOwnedValues(key: string, path: string, value: unknown) {
    const merged = { value: cloneValue(value) };
    const owned = this.owned.get(key);
    if (!owned) return merged;
    const ownedPaths = [...owned.keys()];
    const isBlocked = ownedPaths.some((ownedPath) =>
      isAtOrBelow(path, ownedPath),
    );
    if (isBlocked) return undefined;
    const below = ownedPaths.filter((ownedPath) =>
      isAtOrBelow(ownedPath, path),
    );
    if (below.length === 0) return merged;
    // A scratch model under "/value", so a root write merges the same way.
    const scratch = new DataModel({ value: merged.value });
    const prefix = path === "/" ? "" : path;
    for (const ownedPath of below) {
      const relative = ownedPath.slice(prefix.length);
      scratch.set(`/value${relative}`, cloneValue(owned.get(ownedPath)!.value));
    }
    return { value: scratch.get("/value") };
  }

  private extendsApplied(
    book: Bookkeeping,
    operations: A2UIOperation[],
  ): boolean {
    if (operations.length < book.appliedCount) return false;
    if (book.appliedCount === 0) return true;
    return (
      fingerprint(operations[book.appliedCount - 1]) === book.lastFingerprint
    );
  }

  private createSurface(
    key: string,
    threadId: string,
    agentId: string | undefined,
    content: GenerativeUISurfaceContent,
  ): ManagedSurface {
    const surface: ManagedSurface = {
      key,
      threadId,
      surfaceId: content.surfaceId,
      agentId,
      model: new SurfaceModel(content.surfaceId),
      createdAt: ++creationCounter,
      target: content.target,
      status: content.status,
      deleted: false,
      failed: false,
      serverRejected: content.rejected ?? [],
      clientRejected: [],
      operations: [],
    };
    return surface;
  }

  private disposeSurface(key: string) {
    this.surfaces.get(key)?.model.dispose();
    this.surfaces.delete(key);
    this.bookkeeping.delete(key);
  }

  /**
   * Marks a surface deleted and frees its components and data. The record
   * stays, so the model is still told about the id and the bookkeeping does
   * not rebuild the surface for content that was already applied.
   */
  private closeSurface(surface: ManagedSurface) {
    surface.deleted = true;
    surface.model.dispose();
    surface.model = new SurfaceModel(surface.surfaceId);
    this.owned.delete(surface.key);
    this.linked.delete(surface.key);
  }

  /** The surfaces of a thread that a part of `surfaceId` reads, for tests. */
  getLinkedSurfaceIds(threadId: string, surfaceId: string) {
    const keys = this.linked.get(surfaceKey(threadId, surfaceId));
    if (!keys) return [surfaceId];
    const prefix = `${threadId}::`;
    return [...keys].map((key) => key.slice(prefix.length));
  }

  /**
   * Drops the node keys that the app sets: bound props and matched events.
   * The model does not see them, so a model value for one is ignored, not
   * rejected. This runs before validation, because validation rejects keys
   * that are not in the manifest. It never changes the given operation.
   */
  private dropAppSetKeys(op: unknown) {
    const kind = getOperationKind(op);
    if (kind !== "updateComponents" && kind !== "createSurface") return op;
    // `getOperationKind` found a kind, so `op` is an object. The payload is
    // not checked yet, so every part of it is optional here.
    const record = op as Partial<
      Record<typeof kind, { components?: unknown } | null>
    >;
    const payload = record[kind];
    const nodes = payload?.components;
    if (!Array.isArray(nodes)) return op;
    return {
      ...record,
      [kind]: {
        ...payload,
        components: nodes.map((node) => this.dropAppSetNodeKeys(node)),
      },
    };
  }

  private dropAppSetNodeKeys(node: unknown) {
    if (typeof node !== "object" || node === null || !("component" in node))
      return node;
    const { component } = node;
    if (typeof component !== "string") return node;
    const definition = this.ui.components.get(component);
    if (!definition) return node;
    return Object.fromEntries(
      Object.entries(node).filter(
        ([key]) =>
          !hasOwnKey(definition.selectors, key) &&
          !hasOwnKey(definition.eventFunctions, key),
      ),
    );
  }

  /**
   * The surfaces that `validateOperation` gets for one operation of the
   * content of `surface`.
   *
   * - `knownSurfaces`: the surface, when it exists before the operation. It
   *   does not exist before its first createSurface, or after a delete.
   * - `createdSurfaces`: the surface, when a createSurface at this position
   *   uses its id again. That is the case after the first operation, and for
   *   a surface that was deleted before, unless the content replays that
   *   delete.
   */
  private surfacesFor(
    surface: ManagedSurface,
    kind: OperationKind | undefined,
    position: OperationPosition,
  ) {
    const isFirstCreate = kind === "createSurface" && position.index === 0;
    const exists = !surface.deleted && !isFirstCreate;
    const isRecreate = this.deletedKeys.has(surface.key) && !position.isReplay;
    const isUsedAgain = position.index > 0 || isRecreate;
    return {
      knownSurfaces: new Set(exists ? [surface.surfaceId] : []),
      createdSurfaces: new Set(isUsedAgain ? [surface.surfaceId] : []),
    };
  }

  private applyOperation(
    surface: ManagedSurface,
    received: unknown,
    position: OperationPosition,
  ) {
    const { index } = position;
    const kind = getOperationKind(received);
    // An agent-called function is not a surface operation. The root runs it.
    if (kind === "callRendererFunction") return;
    const reject = (reason: string) => {
      // A surface whose first createSurface fails does not exist.
      if (kind === "createSurface" && index === 0) {
        this.closeSurface(surface);
        surface.failed = true;
      }
      surface.clientRejected.push({ index, reason });
      this.options.onOperationRejected?.({
        surfaceId: surface.surfaceId,
        index,
        reason,
      });
    };
    const targetId = getOperationSurfaceId(received);
    if (targetId !== undefined && targetId !== surface.surfaceId) {
      return reject(
        `operation is for surface "${targetId}", not "${surface.surfaceId}"`,
      );
    }
    const op = this.dropAppSetKeys(received);
    const validation = validateOperation(op, {
      manifest: {
        catalogId: this.ui.id,
        catalogIds: catalogIdsOf(this.ui),
        components: this.ui.manifestComponents,
      },
      ...this.surfacesFor(surface, kind, position),
      allowedComponents: this.allowedComponentsFor(surface),
    });
    if (!validation.ok) return reject(validation.reason);

    // validateOperation checked the shape of `op`.
    const typed = op as A2UIOperation;
    if ("createSurface" in typed) {
      const { dataModel, components = [] } = typed.createSurface;
      const problem = this.nodesProblem(components);
      if (problem) return reject(problem);
      if (dataModel) {
        const failure = this.writeAgentData(surface, "/", dataModel);
        if (failure) return reject(failure);
      }
      for (const node of components) this.upsertNode(surface.model, node);
      return;
    }
    if ("updateComponents" in typed) {
      const nodes = typed.updateComponents.components;
      const problem = this.nodesProblem(nodes);
      if (problem) return reject(problem);
      for (const node of nodes) this.upsertNode(surface.model, node);
      return;
    }
    if ("updateDataModel" in typed) {
      const { path = "/", value } = typed.updateDataModel;
      // A `null` value deletes the key (v1.0). `DataModel.set` removes the
      // key for `null` too, and the merge treats both alike: mapping it to
      // `undefined` only states it.
      const written = value === null ? undefined : value;
      const failure = this.writeAgentData(
        surface,
        normalizePath(path),
        written,
      );
      if (failure) return reject(failure);
      return;
    }
    if ("deleteSurface" in typed) {
      this.closeSurface(surface);
      this.deletedKeys.add(surface.key);
    }
  }

  /** The first node with props of the wrong type, as a reason. */
  private nodesProblem(nodes: A2UIComponentNode[]) {
    for (const node of nodes) {
      const problem = this.checkNodeProps(node);
      if (problem) return `component "${node.id}": ${problem}`;
    }
    return undefined;
  }

  /**
   * Writes an agent value at `path` and keeps the user-owned values. A write
   * to a user-owned path is ignored, not rejected. Gives the reason when the
   * value does not fit the data, else `undefined`.
   */
  private writeAgentData(
    surface: ManagedSurface,
    path: string,
    value: unknown,
  ) {
    try {
      // The merge clones, so the agent's content objects are never mutated
      // or aliased.
      const merged = this.mergeOwnedValues(surface.key, path, value);
      if (merged) surface.model.dataModel.set(path, merged.value);
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  private checkNodeProps(node: A2UIComponentNode): string | undefined {
    const definition = this.ui.components.get(node.component);
    if (!definition) return `unknown component "${node.component}"`;
    const { id: _id, component: _component, ...rest } = node;
    const dataProps = Object.fromEntries(
      Object.entries(rest).filter(
        ([key]) =>
          !definition.events?.[key] &&
          !definition.slots?.[key] &&
          !A2UI_COMPONENT_ENVELOPE_KEYS.has(key),
      ),
    );
    if (!definition.props) return undefined;
    // The props schema checks the literal values. A prop with a `{"@path"}`
    // or `{"@call"}` anywhere in it is known only at render, and so is the
    // value of a bound prop: their issues are left to the render check.
    const unknownNow = new Set(Object.keys(definition.selectors));
    const literals: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(dataProps)) {
      if (containsDynamicValue(value)) unknownNow.add(key);
      else literals[key] = value;
    }
    let result = validateSchemaSync(definition.props, literals);
    if (!result.success) {
      // A null the schema rejects is an unset prop (the render check reads
      // it so too): check again without it.
      const unset = withoutRejectedNulls(literals, result.issues);
      if (unset) result = validateSchemaSync(definition.props, unset);
    }
    if (result.success) return undefined;
    // ponytail: an issue with no path (a check over several props) is left to the render check too, because it can depend on the values above. Only a schema that cannot validate synchronously is reported here.
    const issues = result.issues.filter((issue) => {
      const key = issueKey(issue);
      return key === undefined ? isAsyncIssue(issue) : !unknownNow.has(key);
    });
    return issues.length > 0 ? formatIssues(issues) : undefined;
  }

  private upsertNode(model: SurfaceModel, node: A2UIComponentNode) {
    const { id, component, ...rest } = node;
    const properties = cloneValue(rest);
    const existing = model.componentsModel.get(id);
    if (existing && existing.type === component) {
      existing.properties = properties;
      return;
    }
    if (existing) model.componentsModel.removeComponent(id);
    model.componentsModel.addComponent(
      new ComponentModel(id, component, properties),
    );
  }
}
