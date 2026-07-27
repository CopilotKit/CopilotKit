import { html, LitElement, nothing } from "lit";
import { MessageProcessor } from "@a2ui/web_core/v0_9";
import type { A2uiMessage, Catalog } from "@a2ui/web_core/v0_9";
import { basicCatalog } from "./catalog/basic";
import type { LitComponentImplementation, LitRenderable } from "./types";

const DEFAULT_SURFACE_ID = "default";
const BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getRecordProperty(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function getStringProperty(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getBooleanProperty(
  record: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function getSurfaceId(payload: Record<string, unknown> | undefined): string {
  return payload
    ? (getStringProperty(payload, "surfaceId") ?? DEFAULT_SURFACE_ID)
    : DEFAULT_SURFACE_ID;
}

function getOperationSurfaceId(operation: A2uiMessage): string {
  if ("createSurface" in operation) return operation.createSurface.surfaceId;
  if ("updateComponents" in operation)
    return operation.updateComponents.surfaceId;
  if ("updateDataModel" in operation)
    return operation.updateDataModel.surfaceId;
  if ("deleteSurface" in operation) return operation.deleteSurface.surfaceId;
  return DEFAULT_SURFACE_ID;
}

function normalizeOperations(
  operations: unknown[],
  catalogId: string,
): A2uiMessage[] {
  return operations.flatMap((operation): A2uiMessage[] => {
    if (!isRecord(operation)) return [];

    const createSurface = getRecordProperty(operation, "createSurface");
    if (createSurface) {
      const message = {
        version: "v0.9",
        createSurface: {
          surfaceId: getSurfaceId(createSurface),
          catalogId: getStringProperty(createSurface, "catalogId") ?? catalogId,
          theme: createSurface.theme ?? {},
          sendDataModel: getBooleanProperty(createSurface, "sendDataModel"),
        },
      } satisfies A2uiMessage;
      return [message];
    }

    const updateComponents = getRecordProperty(operation, "updateComponents");
    if (updateComponents) {
      const components = updateComponents.components;
      const message = {
        version: "v0.9",
        updateComponents: {
          surfaceId: getSurfaceId(updateComponents),
          components: Array.isArray(components)
            ? components.map(normalizeComponent)
            : [],
        },
      } satisfies A2uiMessage;
      return [message];
    }

    const updateDataModel = getRecordProperty(operation, "updateDataModel");
    if (updateDataModel) {
      const message = {
        version: "v0.9",
        updateDataModel: {
          surfaceId: getSurfaceId(updateDataModel),
          path: getStringProperty(updateDataModel, "path") ?? "/",
          value: updateDataModel.value,
        },
      } satisfies A2uiMessage;
      return [message];
    }

    const deleteSurface = getRecordProperty(operation, "deleteSurface");
    if (deleteSurface) {
      const message = {
        version: "v0.9",
        deleteSurface: {
          surfaceId: getSurfaceId(deleteSurface),
        },
      } satisfies A2uiMessage;
      return [message];
    }

    const beginRendering = getRecordProperty(operation, "beginRendering");
    if (beginRendering) {
      const message = {
        version: "v0.9",
        createSurface: {
          surfaceId: getSurfaceId(beginRendering),
          catalogId,
          theme: beginRendering.styles ?? {},
          sendDataModel: getBooleanProperty(beginRendering, "sendDataModel"),
        },
      } satisfies A2uiMessage;
      return [message];
    }

    const surfaceUpdate = getRecordProperty(operation, "surfaceUpdate");
    if (surfaceUpdate) {
      const components = surfaceUpdate.components;
      const message = {
        version: "v0.9",
        updateComponents: {
          surfaceId: getSurfaceId(surfaceUpdate),
          components: Array.isArray(components)
            ? components.map(normalizeComponent)
            : [],
        },
      } satisfies A2uiMessage;
      return [message];
    }

    const dataModelUpdate = getRecordProperty(operation, "dataModelUpdate");
    if (dataModelUpdate) {
      const message = {
        version: "v0.9",
        updateDataModel: {
          surfaceId: getSurfaceId(dataModelUpdate),
          path: getStringProperty(dataModelUpdate, "path") ?? "/",
          value: dataModelUpdate.value ?? dataModelUpdate.contents,
        },
      } satisfies A2uiMessage;
      return [message];
    }

    return [];
  });
}

function normalizeComponent(component: unknown): unknown {
  if (!component || typeof component !== "object") return component;
  const record = component as {
    id?: string;
    component?: string | Record<string, unknown>;
    [key: string]: unknown;
  };
  if (!record.component || typeof record.component === "string") return record;

  const entries = Object.entries(record.component);
  if (entries.length !== 1) return record;
  const [componentName, props] = entries[0]!;
  return {
    id: record.id,
    component: componentName,
    ...(props && typeof props === "object" ? props : {}),
  };
}

function toClientEventMessage(action: unknown): Record<string, unknown> {
  const record = isRecord(action) ? action : {};
  return {
    userAction: {
      name: getStringProperty(record, "name") ?? "unknown",
      surfaceId: getStringProperty(record, "surfaceId") ?? DEFAULT_SURFACE_ID,
      sourceComponentId: getStringProperty(record, "sourceComponentId"),
      context: isRecord(record.context) ? record.context : {},
      timestamp:
        getStringProperty(record, "timestamp") ?? new Date().toISOString(),
      dataContextPath: getStringProperty(record, "dataContextPath"),
    },
  };
}

function defaultLoading() {
  return html`
    <div
      class="cpk:flex cpk:flex-col cpk:gap-3 cpk:rounded-xl cpk:border cpk:border-gray-100 cpk:bg-gray-50/50 cpk:p-5"
      style="min-height: 120px;"
      data-testid="a2ui-loading"
    >
      <div class="cpk:flex cpk:items-center cpk:gap-2">
        <div
          class="cpk:h-3 cpk:w-3 cpk:rounded-full cpk:bg-gray-200"
          style="animation: cpk-a2ui-pulse 1.5s ease-in-out infinite;"
          data-testid="a2ui-loading-dot"
        ></div>
        <span class="cpk:text-xs cpk:font-medium cpk:text-gray-400">
          Generating UI...
        </span>
      </div>
      <div class="cpk:flex cpk:flex-col cpk:gap-2">
        ${[0.8, 0.6, 0.4].map(
          (width, i) => html`
            <div
              class="cpk:h-3 cpk:rounded cpk:bg-gray-200/70"
              style=${`width: ${width * 100}%; animation: cpk-a2ui-pulse 1.5s ease-in-out ${i * 0.15}s infinite;`}
              data-testid="a2ui-loading-bar"
            ></div>
          `,
        )}
      </div>
      <style>
        @keyframes cpk-a2ui-pulse {
          0%,
          100% {
            opacity: 0.4;
          }
          50% {
            opacity: 1;
          }
        }
      </style>
    </div>
  `;
}

export class CpkA2uiSurface extends LitElement {
  static properties = {
    operations: { attribute: false },
    catalog: { attribute: false },
    theme: { attribute: false },
    surfaceId: { attribute: false },
    loadingComponent: { attribute: false },
  };

  operations: unknown[] = [];
  catalog?: Catalog<LitComponentImplementation>;
  theme?: Record<string, unknown>;
  surfaceId?: string;
  loadingComponent?: () => LitRenderable;

  private processor: MessageProcessor<LitComponentImplementation> | null = null;
  private processorCatalog?: Catalog<LitComponentImplementation>;
  private lastOpsHash = "";
  private renderedSurfaceIds: string[] = [];
  private error: string | null = null;

  protected createRenderRoot() {
    return this;
  }

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has("catalog")) {
      this.processor = null;
      this.processorCatalog = undefined;
      this.lastOpsHash = "";
      this.renderedSurfaceIds = [];
    }

    if (
      changed.has("operations") ||
      changed.has("catalog") ||
      changed.has("theme") ||
      changed.has("surfaceId")
    ) {
      this.processOperations();
    }
  }

  private getCatalog(): Catalog<LitComponentImplementation> {
    return this.catalog ?? basicCatalog;
  }

  private getProcessor(): MessageProcessor<LitComponentImplementation> {
    const catalog = this.getCatalog();
    if (!this.processor || this.processorCatalog !== catalog) {
      this.processorCatalog = catalog;
      this.processor = new MessageProcessor([catalog], (action) => {
        const message = toClientEventMessage(action);
        this.dispatchEvent(
          new CustomEvent("a2ui-action", {
            detail: message,
            bubbles: true,
            composed: true,
          }),
        );
      });
    }
    return this.processor;
  }

  private processOperations(): void {
    if (!Array.isArray(this.operations) || this.operations.length === 0) {
      this.renderedSurfaceIds = [];
      this.error = null;
      return;
    }

    const catalogId = this.getCatalog().id || BASIC_CATALOG_ID;
    const normalized = normalizeOperations(this.operations, catalogId);
    const hash = JSON.stringify({
      operations: normalized,
      surfaceId: this.surfaceId,
      theme: this.theme,
    });
    if (hash === this.lastOpsHash) return;
    this.lastOpsHash = hash;

    const grouped = new Map<string, A2uiMessage[]>();
    for (const operation of normalized) {
      const surfaceId = this.surfaceId ?? getOperationSurfaceId(operation);
      if (!grouped.has(surfaceId)) grouped.set(surfaceId, []);
      grouped.get(surfaceId)!.push(operation);
    }

    const processor = this.getProcessor();
    try {
      for (const [surfaceId, ops] of grouped) {
        const existing = processor.model.getSurface(surfaceId);
        let filtered = existing
          ? ops.filter((op) => !("createSurface" in op))
          : ops;

        if (!existing && !filtered.some((op) => "createSurface" in op)) {
          filtered = [
            {
              version: "v0.9",
              createSurface: {
                surfaceId,
                catalogId,
                theme: this.theme ?? {},
              },
            },
            ...filtered,
          ];
        }
        processor.processMessages(filtered);
      }
      this.renderedSurfaceIds = [...grouped.keys()];
      this.error = null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.error = message;
      this.dispatchEvent(
        new CustomEvent("a2ui-error", {
          detail: { error: err, message },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  render() {
    if (this.error) {
      return html`
        <div
          class="cpk:rounded-lg cpk:border cpk:border-red-200 cpk:bg-red-50 cpk:p-3 cpk:text-sm cpk:text-red-700"
        >
          A2UI render error: ${this.error}
        </div>
      `;
    }

    if (!this.renderedSurfaceIds.length) {
      return this.loadingComponent ? this.loadingComponent() : defaultLoading();
    }

    const processor = this.getProcessor();
    return html`
      <div
        class="cpk:flex cpk:min-h-0 cpk:flex-1 cpk:flex-col cpk:gap-6 cpk:overflow-auto cpk:py-6"
        data-testid="a2ui-activity-renderer"
      >
        ${this.renderedSurfaceIds.map((surfaceId) => {
          const surface = processor.model.getSurface(surfaceId);
          if (!surface) return nothing;
          return html`
            <div
              class="cpk:flex cpk:w-full cpk:flex-none cpk:flex-col cpk:gap-4"
              data-surface-id=${surfaceId}
            >
              <div
                class="a2ui-surface cpk:flex cpk:flex-1"
                data-surface-id=${surfaceId}
              >
                <cpk-a2ui-node
                  .surface=${surface}
                  .componentId=${"root"}
                  .basePath=${"/"}
                ></cpk-a2ui-node>
              </div>
            </div>
          `;
        })}
      </div>
    `;
  }
}
