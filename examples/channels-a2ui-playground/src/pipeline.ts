import { MessageProcessor } from "@a2ui/web_core/v0_9";
import type { A2uiClientAction } from "@a2ui/web_core/v0_9";
import type { KnownBlock } from "@slack/types";
import { renderBlockKit } from "@copilotkit/channels-slack/render";
import type { ChannelNode, InteractionContext } from "@copilotkit/channels-ui";
import { z } from "zod";
import {
  A2UIIncompleteSurfaceError,
  A2UIUnsupportedComponentError,
  lowerSurface,
} from "./poc/lower-surface.js";
import { createMarketSnapshotCatalog } from "./poc/market-snapshot.js";
import { previewActionId } from "./poc/preview-action-id.js";

export interface PlaygroundDiagnostic {
  level: "error" | "warning" | "info";
  code: string;
  message: string;
  path?: string;
}

export interface CompileA2UIResult {
  ir: ChannelNode[];
  blocks: KnownBlock[];
  diagnostics: PlaygroundDiagnostic[];
  actions: Record<string, () => Promise<unknown>>;
}

const PlaygroundInputSchema = z
  .object({
    surfaceId: z.string().min(1),
    components: z
      .array(
        z
          .object({
            id: z.string().min(1),
            component: z.string().min(1),
          })
          .passthrough(),
      )
      .min(1),
    data: z.unknown().optional(),
  })
  .strict();

type PlaygroundInput = z.infer<typeof PlaygroundInputSchema>;

export function compileA2UIToSlackPreview(input: unknown): CompileA2UIResult {
  const diagnostics: PlaygroundDiagnostic[] = [];
  const parsed = PlaygroundInputSchema.safeParse(input);
  if (!parsed.success) {
    return emptyResult([
      diagnostic(
        "error",
        "INVALID_INPUT",
        parsed.error.issues.map((issue) => issue.message).join("; "),
      ),
    ]);
  }

  const catalog = createMarketSnapshotCatalog();
  const validationDiagnostics = validateComponents(parsed.data, catalog);
  diagnostics.push(...validationDiagnostics);
  diagnostics.push(...simplificationDiagnostics(parsed.data));
  if (validationDiagnostics.some((entry) => entry.level === "error")) {
    return emptyResult(diagnostics);
  }

  const pendingActions = new Map<
    string,
    Array<(action: A2uiClientAction) => void>
  >();
  const processor = new MessageProcessor(
    [catalog.processorCatalog],
    (action) => {
      const clientAction = action as A2uiClientAction;
      const actionId = previewActionId(
        clientAction.surfaceId,
        clientAction.sourceComponentId,
        clientAction.name,
      );
      pendingActions.get(actionId)?.shift()?.(clientAction);
    },
  );

  try {
    processor.processMessages([
      {
        version: "v0.9",
        createSurface: {
          surfaceId: parsed.data.surfaceId,
          catalogId: catalog.id,
        },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: parsed.data.surfaceId,
          components: parsed.data.components,
        },
      },
      ...(parsed.data.data === undefined
        ? []
        : [
            {
              version: "v0.9" as const,
              updateDataModel: {
                surfaceId: parsed.data.surfaceId,
                path: "/",
                value: parsed.data.data,
              },
            },
          ]),
    ]);
  } catch (error) {
    return emptyResult([
      ...diagnostics,
      diagnostic("error", "INVALID_SCHEMA", errorMessage(error)),
    ]);
  }

  try {
    const surface = processor.model.getSurface(parsed.data.surfaceId);
    if (!surface) {
      return emptyResult([
        ...diagnostics,
        diagnostic(
          "error",
          "MISSING_SURFACE",
          `A2UI surface "${parsed.data.surfaceId}" was not created.`,
        ),
      ]);
    }
    const rawIr = lowerSurface(surface, {
      async dispatchAction(_interaction, _expectedAction, dispatch) {
        await dispatch();
      },
    });
    const { ir, actions } = materializeActionHandlers(
      rawIr,
      (actionId, click) =>
        dispatchPreviewAction(actionId, click, pendingActions),
    );
    const blocks = renderBlockKit(ir);
    return { ir, blocks, diagnostics, actions };
  } catch (error) {
    return emptyResult([...diagnostics, diagnosticForError(error)]);
  }
}

function validateComponents(
  input: PlaygroundInput,
  catalog: ReturnType<typeof createMarketSnapshotCatalog>,
): PlaygroundDiagnostic[] {
  const diagnostics: PlaygroundDiagnostic[] = [];
  const seen = new Set<string>();
  const knownComponents = catalog.processorCatalog.components;
  for (const [index, component] of input.components.entries()) {
    const path = `components.${index}`;
    if (!component.id) {
      diagnostics.push(
        diagnostic(
          "error",
          "MISSING_ID",
          "A2UI components must include a nonempty id.",
          path,
        ),
      );
    } else if (seen.has(component.id)) {
      diagnostics.push(
        diagnostic(
          "error",
          "DUPLICATE_ID",
          `Duplicate component id "${component.id}".`,
          path,
        ),
      );
    } else {
      seen.add(component.id);
    }
    const implementation = knownComponents.get(component.component);
    if (!implementation) {
      diagnostics.push(
        diagnostic(
          "error",
          "UNSUPPORTED_COMPONENT",
          `Unsupported A2UI component "${component.component}".`,
          path,
        ),
      );
      continue;
    }
    const propResult = implementation.schema.safeParse(
      componentProps(component),
    );
    if (!propResult.success) {
      diagnostics.push(
        diagnostic(
          "error",
          "INVALID_COMPONENT_PROPS",
          propResult.error.issues.map((issue) => issue.message).join("; "),
          path,
        ),
      );
    }
  }
  if (!seen.has("root")) {
    diagnostics.push(
      diagnostic(
        "error",
        "MISSING_ROOT",
        'A2UI surface must include a "root" component.',
      ),
    );
  }
  return diagnostics;
}

function simplificationDiagnostics(
  input: PlaygroundInput,
): PlaygroundDiagnostic[] {
  const diagnostics: PlaygroundDiagnostic[] = [];
  for (const [index, component] of input.components.entries()) {
    const path = `components.${index}`;
    if (component.component === "Row" || component.component === "Column") {
      diagnostics.push(
        diagnostic(
          "warning",
          "LAYOUT_SIMPLIFIED",
          `${component.component} layout is flattened for Slack Block Kit preview.`,
          path,
        ),
      );
    }
    if (component.component === "Card") {
      diagnostics.push(
        diagnostic(
          "warning",
          "LAYOUT_SIMPLIFIED",
          "Card framing is flattened for Slack Block Kit preview.",
          path,
        ),
      );
    }
    if (
      component.component === "Text" &&
      typeof component.variant === "string" &&
      component.variant !== "body"
    ) {
      diagnostics.push(
        diagnostic(
          "warning",
          "TEXT_VARIANT_SIMPLIFIED",
          `Text variant "${component.variant}" is approximated with Slack text blocks.`,
          path,
        ),
      );
    }
    if (component.component === "MarketSnapshot") {
      diagnostics.push(...textLimitDiagnostics(component, path));
    }
  }
  return diagnostics;
}

function componentProps(
  component: PlaygroundInput["components"][number],
): Record<string, unknown> {
  const { id: _id, component: _component, ...props } = component;
  return props;
}

function textLimitDiagnostics(
  component: PlaygroundInput["components"][number],
  path: string,
): PlaygroundDiagnostic[] {
  const diagnostics: PlaygroundDiagnostic[] = [];
  const headline = component.headline;
  if (typeof headline === "string" && headline.length > 150) {
    diagnostics.push(
      diagnostic(
        "warning",
        "TEXT_TRUNCATED",
        "MarketSnapshot headline exceeds Slack header text limits.",
        path,
      ),
    );
  }
  const summary = component.summary;
  if (typeof summary === "string" && summary.length > 3000) {
    diagnostics.push(
      diagnostic(
        "warning",
        "TEXT_TRUNCATED",
        "MarketSnapshot summary exceeds Slack section text limits.",
        path,
      ),
    );
  }
  return diagnostics;
}

function materializeActionHandlers(
  nodes: ChannelNode[],
  run: (
    actionId: string,
    click: (interaction: InteractionContext) => void | Promise<void>,
  ) => Promise<unknown>,
): {
  ir: ChannelNode[];
  actions: Record<string, () => Promise<unknown>>;
} {
  const actions: Record<string, () => Promise<unknown>> = {};
  const ir = nodes.map((node) => materializeNode(node, actions, run));
  return { ir, actions };
}

function materializeNode(
  node: ChannelNode,
  actions: Record<string, () => Promise<unknown>>,
  run: (
    actionId: string,
    click: (interaction: InteractionContext) => void | Promise<void>,
  ) => Promise<unknown>,
): ChannelNode {
  const props = { ...node.props };
  if (Array.isArray(props.children)) {
    props.children = (props.children as ChannelNode[]).map((child) =>
      materializeNode(child, actions, run),
    );
  }
  if (node.type === "button" && typeof props.onClick === "function") {
    const id = handlerId(props.onClick);
    if (id) {
      const click = props.onClick as (interaction: InteractionContext) => void;
      actions[id] = () => run(id, click);
      props.onClick = { id };
    }
  }
  return { ...node, props };
}

async function dispatchPreviewAction(
  actionId: string,
  click: (interaction: InteractionContext) => void | Promise<void>,
  pendingActions: Map<string, Array<(action: A2uiClientAction) => void>>,
): Promise<unknown> {
  let resolvedAction: A2uiClientAction | undefined;
  const resolver = (action: A2uiClientAction) => {
    resolvedAction = action;
  };
  const queue = pendingActions.get(actionId) ?? [];
  queue.push(resolver);
  pendingActions.set(actionId, queue);
  try {
    await click(createPreviewInteraction(actionId));
  } catch (error) {
    removePendingAction(pendingActions, actionId, resolver);
    throw error;
  }
  if (!resolvedAction) {
    removePendingAction(pendingActions, actionId, resolver);
    throw new Error(`No A2UI action was dispatched for "${actionId}".`);
  }
  return resolvedAction;
}

function removePendingAction(
  pendingActions: Map<string, Array<(action: A2uiClientAction) => void>>,
  actionId: string,
  resolver: (action: A2uiClientAction) => void,
): void {
  const queue = pendingActions.get(actionId);
  if (!queue) return;
  const index = queue.indexOf(resolver);
  if (index >= 0) queue.splice(index, 1);
  if (queue.length === 0) pendingActions.delete(actionId);
}

function handlerId(handler: unknown): string | undefined {
  if (
    handler &&
    (typeof handler === "object" || typeof handler === "function") &&
    "id" in handler
  ) {
    const id = (handler as { id?: unknown }).id;
    if (typeof id === "string") return id;
  }
  return undefined;
}

function createPreviewInteraction(actionId: string): InteractionContext {
  return {
    platform: "slack",
    thread: {},
    message: {
      text: "",
      user: null,
      actor: { id: "preview", kind: "unknown" },
      ref: {},
      platform: "slack",
    },
    action: { id: actionId },
    values: {},
    user: null,
    actor: { id: "preview", kind: "unknown" },
  } as InteractionContext;
}

function diagnosticForError(error: unknown): PlaygroundDiagnostic {
  if (error instanceof A2UIIncompleteSurfaceError) {
    return diagnostic("error", "MISSING_ROOT", error.message);
  }
  if (error instanceof A2UIUnsupportedComponentError) {
    return diagnostic("error", "UNSUPPORTED_COMPONENT", error.message);
  }
  const message = errorMessage(error);
  if (message.includes("Cyclic A2UI component reference")) {
    return diagnostic("error", "CYCLIC_REFERENCE", message);
  }
  return diagnostic("error", "RENDER_FAILED", message);
}

function emptyResult(diagnostics: PlaygroundDiagnostic[]): CompileA2UIResult {
  return { ir: [], blocks: [], diagnostics, actions: {} };
}

function diagnostic(
  level: PlaygroundDiagnostic["level"],
  code: string,
  message: string,
  path?: string,
): PlaygroundDiagnostic {
  return { level, code, message, ...(path ? { path } : {}) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
