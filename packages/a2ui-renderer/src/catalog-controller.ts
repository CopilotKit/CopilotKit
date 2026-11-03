import { Catalog } from "@a2ui/web_core/v0_9";
import type { CatalogInterface, ComponentApi } from "@a2ui/web_core/v0_9";
import type { CopilotKitCore } from "@copilotkit/core";
import { buildA2UIContextEntries } from "./catalog-context";
import type { CatalogSchemaSource } from "./catalog-description";
import { filterCatalog } from "./filter-catalog";

/** The core members the catalog controller uses. */
export type A2UICatalogCore = Pick<
  CopilotKitCore,
  | "addContext"
  | "removeContext"
  | "a2uiAgents"
  | "setCatalogComponents"
  | "isCatalogComponentEnabled"
  | "subscribe"
>;

export interface A2UICatalogState<C> {
  /** Whether A2UI is on; the agent context is registered only then. */
  enabled: boolean;
  /** The catalog the app passed, if any. */
  catalog: C | undefined;
  /** Send component schemas and guidelines as context. Default true. */
  includeSchema?: boolean;
}

/**
 * Keeps an A2UI catalog in sync with core, for React, Vue and Angular alike:
 *
 * - registers the catalog's components with core, so the Inspector can list
 *   and toggle them;
 * - derives the catalog with disabled components removed, so a toggle
 *   changes both what the model is told and what can render;
 * - registers the agent context entries for that catalog while A2UI is on,
 *   scoped to the agents the runtime applies A2UI to (#5369), and registers
 *   them again when that list changes.
 *
 * Only real `Catalog` instances are registered and filtered; a catalog-shaped
 * object passes through as is, so nothing is toggleable that cannot be
 * removed.
 *
 * @example
 * ```ts
 * const controller = new A2UICatalogController(core, basicCatalog);
 * controller.subscribe(() => render(controller.getSnapshot()));
 * controller.update({ enabled: true, catalog, includeSchema: true });
 * // on teardown:
 * controller.dispose();
 * ```
 */
export class A2UICatalogController<C extends CatalogInterface<ComponentApi>> {
  readonly #core: A2UICatalogCore;
  readonly #defaultCatalog: CatalogSchemaSource;
  readonly #listeners = new Set<() => void>();
  #subscription: { unsubscribe: () => void } | undefined;
  #state: A2UICatalogState<C> = { enabled: false, catalog: undefined };
  #filtered: C | undefined;
  #contextIds: string[] = [];
  #contextKey = "";

  /**
   * @param core - The CopilotKit core.
   * @param defaultCatalog - Described to the agent when no catalog is passed.
   */
  constructor(core: A2UICatalogCore, defaultCatalog: CatalogSchemaSource) {
    this.#core = core;
    this.#defaultCatalog = defaultCatalog;
  }

  /** The catalog with disabled components removed. Stable until a change. */
  getSnapshot = () => this.#filtered;

  /** Calls `listener` when the filtered catalog changes. Returns the unsubscribe function. */
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** Applies the latest options. */
  update(state: A2UICatalogState<C>) {
    this.#subscription ??= this.#core.subscribe({
      onCatalogComponentsChanged: () => {
        this.#refilter();
        this.#syncContext();
      },
      onRuntimeConnectionStatusChanged: () => this.#syncContext(),
    });
    const catalogChanged = state.catalog !== this.#state.catalog;
    this.#state = state;
    if (catalogChanged) {
      const catalog = state.catalog;
      if (catalog instanceof Catalog) {
        this.#core.setCatalogComponents(
          [...catalog.components.values()].map((component) => ({
            name: component.name,
            description: undefined,
            schema: component.schema,
          })),
        );
      }
      this.#refilter();
    }
    this.#syncContext();
  }

  /**
   * Removes the agent context and stops listening to core. A later
   * `update()` starts again, so a remounted component can keep the controller.
   */
  dispose() {
    this.#subscription?.unsubscribe();
    this.#subscription = undefined;
    this.#removeContext();
    this.#state = { enabled: false, catalog: undefined };
  }

  #refilter() {
    const catalog = this.#state.catalog;
    const filtered =
      catalog instanceof Catalog
        ? filterCatalog(catalog, (name) =>
            this.#core.isCatalogComponentEnabled(name),
          )
        : catalog;
    this.#filtered = filtered;
    for (const listener of this.#listeners) listener();
  }

  #syncContext() {
    if (!this.#state.enabled) {
      this.#removeContext();
      return;
    }
    const entries = buildA2UIContextEntries(
      this.#filtered ?? this.#defaultCatalog,
      {
        includeSchema: this.#state.includeSchema,
        agentIds: this.#core.a2uiAgents,
      },
    );
    const key = JSON.stringify(entries);
    if (key === this.#contextKey) return;
    this.#removeContext();
    this.#contextKey = key;
    this.#contextIds = entries.map((entry) => this.#core.addContext(entry));
  }

  #removeContext() {
    for (const id of this.#contextIds) this.#core.removeContext(id);
    this.#contextIds = [];
    this.#contextKey = "";
  }
}
