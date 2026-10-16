import {
  Catalog,
  ComponentModel,
  DataModel,
  SurfaceModel,
} from "@a2ui/web_core/v0_9";
import { z } from "zod";
import {
  GENERATIVE_UI_MAX_REJECTION_LENGTH,
  GENERATIVE_UI_MAX_SUMMARY_REJECTIONS,
  getOperationKind,
  getOperationSurfaceId,
  isIndexCall,
  isPathBinding,
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
import type { GenerativeUI } from "./catalog";
import {
  formatIssues,
  isAsyncIssue,
  issueKey,
  validateSchemaSync,
} from "./schema";

export function surfaceKey(threadId: string, surfaceId: string): string {
  return `${threadId}::${surfaceId}`;
}

export interface ManagedSurface {
  readonly key: string;
  readonly threadId: string;
  readonly surfaceId: string;
  readonly agentId: string | undefined;
  readonly model: SurfaceModel<any>;
  readonly createdAt: number;
  target: string;
  status: GenerativeUISurfaceStatus;
  deleted: boolean;
  /** Rejections reported by the runtime. */
  serverRejected: GenerativeUIRejectedOperation[];
  /** Rejections detected while applying operations in the browser. */
  clientRejected: GenerativeUIRejectedOperation[];
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

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

/** "/a/b/" to "/a/b". The root stays "/". */
function normalizePath(path: string) {
  const trimmed =
    path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  return trimmed || "/";
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
 * Framework-agnostic store of generated surfaces. One web_core SurfaceModel per
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
  private readonly owned = new Map<string, Map<string, unknown>>();
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
  private readonly webCoreCatalog: Catalog<any>;
  private activeThreadId: string | undefined;
  private version = 0;

  constructor(
    private readonly ui: GenerativeUI,
    private readonly options: GenerativeUISurfaceManagerOptions = {},
  ) {
    this.webCoreCatalog = new Catalog(
      ui.id,
      [...ui.components.keys()].map((name) => ({ name, schema: z.any() })),
      [],
    );
  }

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

    if (surface && book && !this.extendsApplied(book, operations)) {
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
      // Fingerprint the pristine operation before applying it.
      const lastFingerprint = JSON.stringify(operations[operations.length - 1]);
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
      book.lastFingerprint = lastFingerprint;
    }
    if (
      surface.status !== content.status ||
      surface.target !== content.target ||
      surface.serverRejected.length !== serverRejected.length
    ) {
      surface.status = content.status;
      surface.target = content.target;
      surface.serverRejected = serverRejected;
      changed = true;
    }
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
   * The surfaces of a thread, for the model. A surface with user-owned
   * values lists them in `dataModel`, so the model can read what the user
   * entered. A surface with dropped operations lists them in `rejected`, so
   * the model can fix them on the next run.
   */
  describeSurfaces(threadId: string) {
    const described: Record<string, GenerativeUISurfaceSummary> = {};
    for (const surface of this.surfaces.values()) {
      if (surface.threadId !== threadId || surface.deleted) continue;
      const owned = this.owned.get(surface.key);
      const rejections = [...surface.serverRejected, ...surface.clientRejected];
      described[surface.surfaceId] = {
        target: surface.target,
        ...(owned && owned.size > 0
          ? { dataModel: Object.fromEntries(owned) }
          : {}),
        ...(rejections.length > 0
          ? { rejected: summarizeRejections(rejections) }
          : {}),
      };
    }
    return described;
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
      Object.hasOwn(this.state, key) && Object.is(this.state[key], value);
    if (isUnchanged) return;
    this.state = { ...this.state, [key]: value };
    this.notify();
  }

  /** Removes one state key. Notifies only when the key was set. */
  removeState(key: string) {
    if (!Object.hasOwn(this.state, key)) return;
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
   * surface is deleted. Does nothing for an unknown or deleted surface. The
   * surfaces linked to it (see `linkSurfaces`) get the same write.
   *
   * @param key - The `key` of the surface.
   * @param path - An absolute JSON pointer, for example "/form/email".
   * @param value - The new value. It is copied.
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
    for (const target of this.linked.get(key) ?? [key]) {
      this.writeOwnedValue(target, normalized, value);
    }
  }

  private writeOwnedValue(key: string, path: string, value: unknown) {
    const surface = this.surfaces.get(key);
    if (!surface || surface.deleted) return;
    surface.model.dataModel.set(path, structuredClone(value));
    const owned = this.owned.get(key) ?? new Map<string, unknown>();
    owned.set(path, structuredClone(value));
    this.owned.set(key, owned);
  }

  /**
   * Writes the user-owned values into the new, empty data model of a rebuilt
   * surface. The agent operations are applied after it.
   */
  private restoreOwnedValues(surface: ManagedSurface) {
    const owned = this.owned.get(surface.key) ?? new Map<string, unknown>();
    for (const [path, value] of owned) {
      surface.model.dataModel.set(path, structuredClone(value));
    }
  }

  /**
   * The value that an agent write puts at `path`, with the user-owned values
   * below `path` written back into it. `undefined` when `path` is user-owned
   * or below a user-owned path, so the agent cannot write it. Throws when a
   * user value does not fit the new value.
   */
  private mergeOwnedValues(key: string, path: string, value: unknown) {
    const merged = { value: structuredClone(value) };
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
      scratch.set(`/value${relative}`, structuredClone(owned.get(ownedPath)));
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
      JSON.stringify(operations[book.appliedCount - 1]) === book.lastFingerprint
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
      model: new SurfaceModel(content.surfaceId, this.webCoreCatalog),
      createdAt: ++creationCounter,
      target: content.target,
      status: content.status,
      deleted: false,
      serverRejected: content.rejected ?? [],
      clientRejected: [],
    };
    return surface;
  }

  private disposeSurface(key: string) {
    this.surfaces.get(key)?.model.dispose();
    this.surfaces.delete(key);
    this.bookkeeping.delete(key);
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
          !Object.hasOwn(definition.selectors, key) &&
          !Object.hasOwn(definition.eventFunctions, key),
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
      if (kind === "createSurface" && index === 0) surface.deleted = true;
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
      // A `null` value deletes the key. web_core deletes it for `undefined`.
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
      surface.deleted = true;
      this.deletedKeys.add(surface.key);
      this.owned.delete(surface.key);
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
        ([key]) => !definition.events?.[key] && !definition.slots?.[key],
      ),
    );
    if (!definition.props) return undefined;
    // The props schema checks the literal values. A `{"@path"}` or
    // `{"@call":"@index"}` value is known only at render, and so is the
    // value of a bound prop: their issues are left to the render check.
    const unknownNow = new Set(Object.keys(definition.selectors));
    const literals: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(dataProps)) {
      if (isPathBinding(value) || isIndexCall(value)) unknownNow.add(key);
      else literals[key] = value;
    }
    const result = validateSchemaSync(definition.props, literals);
    if (result.success) return undefined;
    // ponytail: an issue with no path (a check over several props) is left to the render check too, because it can depend on the values above. Only a schema that cannot validate synchronously is reported here.
    const issues = result.issues.filter((issue) => {
      const key = issueKey(issue);
      return key === undefined ? isAsyncIssue(issue) : !unknownNow.has(key);
    });
    return issues.length > 0 ? formatIssues(issues) : undefined;
  }

  private upsertNode(model: SurfaceModel<any>, node: A2UIComponentNode) {
    const { id, component, ...rest } = node;
    const properties = structuredClone(rest);
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
