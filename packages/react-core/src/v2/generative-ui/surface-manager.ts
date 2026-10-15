import { Catalog, ComponentModel, SurfaceModel } from "@a2ui/web_core/v0_9";
import { z } from "zod";
import { getOperationKind, validateOperation } from "@copilotkit/shared";
import type {
  A2UIComponentNode,
  A2UIOperation,
  GenerativeUIRejectedOperation,
  GenerativeUISurfaceContent,
  GenerativeUISurfaceStatus,
} from "@copilotkit/shared";
import type { GenerativeUI } from "./catalog";

export function surfaceKey(threadId: string, surfaceId: string): string {
  return `${threadId}::${surfaceId}`;
}

const fieldKey = (key: string, componentId: string, name: string) =>
  `${key}::${componentId}::${name}`;

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

export interface GenerativeUIFieldState {
  readonly value: unknown;
  readonly dirty: true;
}

export interface GenerativeUISurfaceManagerOptions {
  onOperationRejected?: (info: {
    surfaceId: string;
    index: number;
    reason: string;
  }) => void;
}

interface Bookkeeping {
  appliedCount: number;
  lastFingerprint: string | undefined;
}

/** One mount of a target. Each mount gets its own object. */
interface TargetRegistration {
  readonly description: string | undefined;
}

/** A mounted target, as the manifest lists it. */
export interface GenerativeUIMountedTarget {
  id: string;
  description?: string;
}

const PATH_BINDING = z.object({ path: z.string() }).strict();
let creationCounter = 0;

/**
 * Framework-agnostic store of generated surfaces. One web_core SurfaceModel per
 * (threadId, surfaceId), shared by every mount. Applies only newly committed
 * operations, validates each before applying it, and owns app state and user
 * field drafts so agent updates cannot overwrite them. App state never goes
 * into a surface's data model. Selectors read it with `getState()`.
 */
export class GenerativeUISurfaceManager {
  private readonly surfaces = new Map<string, ManagedSurface>();
  private readonly bookkeeping = new Map<string, Bookkeeping>();
  private readonly listeners = new Set<() => void>();
  /** Mounts of each target id, in mount order. */
  private readonly targets = new Map<string, Set<TargetRegistration>>();
  private state: Readonly<Record<string, unknown>> = {};
  private readonly fields = new Map<string, GenerativeUIFieldState>();
  private readonly wireSchemas = new Map<string, z.ZodTypeAny>();
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
      for (let index = book.appliedCount; index < operations.length; index++) {
        this.applyOperation(surface, operations[index], index);
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

  describeSurfaces(threadId: string): Record<string, { target: string }> {
    const described: Record<string, { target: string }> = {};
    for (const surface of this.surfaces.values()) {
      if (surface.threadId === threadId && !surface.deleted) {
        described[surface.surfaceId] = { target: surface.target };
      }
    }
    return described;
  }

  /**
   * Marks a target as mounted. Returns the function that unmounts it. Calling
   * that function more than once has no effect.
   */
  registerTarget(id: string, description?: string) {
    const registration: TargetRegistration = { description };
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

  /** The mounted targets, each with the description of its earliest mount. */
  getMountedTargets() {
    const mounted: GenerativeUIMountedTarget[] = [];
    for (const [id, registrations] of this.targets) {
      // ponytail: when mounts of one id have different descriptions, the earliest mount that is still mounted and has a description wins. A mount without a description does not hide the description of a later mount.
      const description = [...registrations].find(
        (registration) => registration.description !== undefined,
      )?.description;
      mounted.push(description === undefined ? { id } : { id, description });
    }
    return mounted;
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

  getField(
    key: string,
    componentId: string,
    name: string,
  ): GenerativeUIFieldState | undefined {
    return this.fields.get(fieldKey(key, componentId, name));
  }

  setField(key: string, componentId: string, name: string, value: unknown) {
    this.fields.set(fieldKey(key, componentId, name), { value, dirty: true });
    this.notify();
  }

  resetField(key: string, componentId: string, name: string) {
    if (this.fields.delete(fieldKey(key, componentId, name))) this.notify();
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

  /**
   * Drops the node keys that the app sets: bound props and matched events.
   * The model does not see them, so a model value for one is ignored, not
   * rejected. This runs before validation, because validation rejects keys
   * that are not in the manifest. It never changes the given operation.
   */
  private dropAppSetKeys(op: unknown) {
    if (getOperationKind(op) !== "updateComponents") return op;
    // `getOperationKind` found a kind, so `op` is an object. The payload is
    // not checked yet, so every part of it is optional here.
    const record = op as {
      updateComponents?: { components?: unknown } | null;
    };
    const payload = record.updateComponents;
    const nodes = payload?.components;
    if (!Array.isArray(nodes)) return op;
    return {
      ...record,
      updateComponents: {
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

  private applyOperation(
    surface: ManagedSurface,
    received: unknown,
    index: number,
  ) {
    const reject = (reason: string) => {
      surface.clientRejected.push({ index, reason });
      this.options.onOperationRejected?.({
        surfaceId: surface.surfaceId,
        index,
        reason,
      });
    };
    const op = this.dropAppSetKeys(received);
    if (getOperationKind(op) === "createSurface") {
      if (index !== 0) reject("createSurface may only be the first operation");
      return;
    }
    const validation = validateOperation(op, {
      manifest: {
        catalogId: this.ui.id,
        components: this.ui.manifestComponents,
      },
      knownSurfaces: new Set([surface.surfaceId]),
    });
    if (!validation.ok) return reject(validation.reason);

    const typed = op as A2UIOperation;
    if ("updateComponents" in typed) {
      const nodes = typed.updateComponents.components;
      for (const node of nodes) {
        const problem = this.checkNodeProps(node);
        if (problem) return reject(`component "${node.id}": ${problem}`);
      }
      for (const node of nodes) this.upsertNode(surface.model, node);
      return;
    }
    if ("updateDataModel" in typed) {
      const path = typed.updateDataModel.path ?? "/";
      try {
        // Clone so the agent's content objects are never mutated or aliased.
        surface.model.dataModel.set(
          path,
          structuredClone(typed.updateDataModel.value),
        );
      } catch (error) {
        return reject(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    if ("deleteSurface" in typed) surface.deleted = true;
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
    const result = this.wireSchema(node.component).safeParse(dataProps);
    if (result.success) return undefined;
    return result.error.issues
      .map((issue) => `${issue.path.join(".") || "props"}: ${issue.message}`)
      .join("; ");
  }

  /**
   * The schema of the props the model sets (`modelProps`), where every prop
   * may also be a `{ path }` binding. Bound props are not in it, so a missing
   * required bound prop does not fail.
   */
  private wireSchema(name: string): z.ZodTypeAny {
    let schema = this.wireSchemas.get(name);
    if (!schema) {
      const shape = this.ui.components.get(name)?.modelProps.shape ?? {};
      schema = z.object(
        Object.fromEntries(
          Object.entries(shape).map(([key, propSchema]) => [
            key,
            z.union([PATH_BINDING, propSchema as z.ZodTypeAny]),
          ]),
        ),
      );
      this.wireSchemas.set(name, schema);
    }
    return schema;
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
