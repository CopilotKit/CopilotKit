/**
 * Gen UI 2.0 surfaces, written by the agent itself.
 *
 * Every surface is one `generative-ui-surface` activity message with A2UI
 * v1.0 operations, the same events the runtime's `render_ui` tool emits:
 * an ACTIVITY_SNAPSHOT that creates it, then ACTIVITY_DELTA patches that
 * append operations and flip its status. The client validates and applies
 * each operation as it lands, so the surface paints while it streams.
 *
 * Copied from a2ui-playground `src/agent/surface.ts`. `createSurfaceWriter`
 * from `@copilotkit/runtime/v2` emits the same events (experimental); this
 * class adds `reopen()` for in-place updates across runs.
 */
import {
  A2UI_VERSION,
  GENERATIVE_UI_ACTIVITY_TYPE,
  GENERATIVE_UI_CHAT_TARGET,
  generativeUISurfaceMessageId,
  type A2UIComponentNode,
  type A2UIOperation,
  type GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import { CATALOG_ID } from "@/a2ui/catalog/ids"; // must equal the id passed to createGenerativeUI
import { EventType, type EventQueue } from "./events";

export type Node = A2UIComponentNode;

/** One surface: what an agent needs to render it again or change it later. */
export type SurfaceRecord = {
  surfaceId: string;
  components: Node[];
  data?: Record<string, unknown>;
};

const createOp = (
  surfaceId: string,
  components?: Node[],
  dataModel?: Record<string, unknown>,
): A2UIOperation => ({
  version: A2UI_VERSION,
  createSurface: {
    surfaceId,
    catalogId: CATALOG_ID,
    ...(components?.length ? { components } : {}),
    ...(dataModel ? { dataModel } : {}),
  },
});
const componentsOp = (
  surfaceId: string,
  components: Node[],
): A2UIOperation => ({
  version: A2UI_VERSION,
  updateComponents: { surfaceId, components },
});
const dataOp = (
  surfaceId: string,
  value: unknown,
  path = "/",
): A2UIOperation => ({
  version: A2UI_VERSION,
  updateDataModel: { surfaceId, path, value },
});

export class SurfaceStream {
  readonly messageId: string;
  constructor(
    private q: EventQueue,
    readonly surfaceId: string,
  ) {
    this.messageId = generativeUISurfaceMessageId(surfaceId);
  }

  /** Creates the surface (a new activity message), optionally with its first components and data. */
  create(components?: Node[], dataModel?: Record<string, unknown>) {
    const content: GenerativeUISurfaceContent = {
      surfaceId: this.surfaceId,
      target: GENERATIVE_UI_CHAT_TARGET,
      catalogId: CATALOG_ID,
      operations: [createOp(this.surfaceId, components, dataModel)],
      status: "streaming",
      rejected: [],
    };
    this.q.push({
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: this.messageId,
      activityType: GENERATIVE_UI_ACTIVITY_TYPE,
      content,
      replace: true,
    });
  }

  /** Reopens a surface from an earlier run: it streams again and starts with no rejections. */
  reopen() {
    this.patch([
      { op: "replace", path: "/status", value: "streaming" },
      { op: "replace", path: "/rejected", value: [] },
    ]);
  }

  /** Adds or replaces components by id. A node may change its type (Blueprint to Stat). */
  upsert(...components: Node[]) {
    if (components.length)
      this.append(componentsOp(this.surfaceId, components));
  }

  /** Sets `value` at `path` of the data model ("/" replaces all of it). */
  data(value: unknown, path = "/") {
    this.append(dataOp(this.surfaceId, value, path));
  }

  close() {
    this.patch([{ op: "replace", path: "/status", value: "ready" }]);
  }

  private append(operation: A2UIOperation) {
    this.patch([{ op: "add", path: "/operations/-", value: operation }]);
  }

  private patch(patch: Array<Record<string, unknown>>) {
    this.q.push({
      type: EventType.ACTIVITY_DELTA,
      messageId: this.messageId,
      activityType: GENERATIVE_UI_ACTIVITY_TYPE,
      patch,
    });
  }
}
