export type CopilotHookName = (typeof HOOK_REGISTRY)[number]["name"];

export type RenderPropsKind =
  | "action"
  | "coagent-state"
  | "interrupt"
  | "render-tool"
  | "human-in-the-loop"
  | "custom-messages"
  | "activity-message";

export interface HookDef {
  name: string;
  category: "render" | "data";
  identityField: "name" | "nodeName" | null;
  renderProps: RenderPropsKind | null;
  importSource: "@copilotkit/react-core" | "@copilotkit/react-core/v2";
}

export const HOOK_REGISTRY = [
  // V1 render hooks
  {
    name: "useCopilotAction",
    category: "render",
    identityField: "name",
    renderProps: "action",
    importSource: "@copilotkit/react-core",
  },
  {
    name: "useCopilotAuthenticatedAction_c",
    category: "render",
    identityField: "name",
    renderProps: "action",
    importSource: "@copilotkit/react-core",
  },
  {
    name: "useCoAgentStateRender",
    category: "render",
    identityField: "name",
    renderProps: "coagent-state",
    importSource: "@copilotkit/react-core",
  },
  {
    name: "useLangGraphInterrupt",
    category: "render",
    identityField: null,
    renderProps: "interrupt",
    importSource: "@copilotkit/react-core",
  },

  // V2 render hooks
  {
    name: "useRenderTool",
    category: "render",
    identityField: "name",
    renderProps: "render-tool",
    importSource: "@copilotkit/react-core/v2",
  },
  {
    name: "useRenderToolCall",
    category: "render",
    identityField: "name",
    renderProps: "render-tool",
    importSource: "@copilotkit/react-core/v2",
  },
  {
    name: "useDefaultRenderTool",
    category: "render",
    identityField: "name",
    renderProps: "render-tool",
    importSource: "@copilotkit/react-core/v2",
  },
  {
    name: "useLazyToolRenderer",
    category: "render",
    identityField: "name",
    renderProps: "render-tool",
    importSource: "@copilotkit/react-core/v2",
  },
  {
    name: "useRenderCustomMessages",
    category: "render",
    identityField: null,
    renderProps: "custom-messages",
    importSource: "@copilotkit/react-core/v2",
  },
  {
    name: "useRenderActivityMessage",
    category: "render",
    identityField: null,
    renderProps: "activity-message",
    importSource: "@copilotkit/react-core/v2",
  },
  {
    name: "useHumanInTheLoop",
    category: "render",
    identityField: "name",
    renderProps: "human-in-the-loop",
    importSource: "@copilotkit/react-core/v2",
  },
  {
    name: "useInterrupt",
    category: "render",
    identityField: null,
    renderProps: "interrupt",
    importSource: "@copilotkit/react-core/v2",
  },
  {
    name: "useFrontendTool",
    category: "render",
    identityField: "name",
    renderProps: "render-tool",
    importSource: "@copilotkit/react-core/v2",
  },

  // V1 data hooks
  {
    name: "useCopilotReadable",
    category: "data",
    identityField: null,
    renderProps: null,
    importSource: "@copilotkit/react-core",
  },
  {
    name: "useCopilotAdditionalInstructions",
    category: "data",
    identityField: null,
    renderProps: null,
    importSource: "@copilotkit/react-core",
  },
  {
    name: "useCoAgent",
    category: "data",
    identityField: "name",
    renderProps: null,
    importSource: "@copilotkit/react-core",
  },
  {
    name: "useCopilotChat",
    category: "data",
    identityField: null,
    renderProps: null,
    importSource: "@copilotkit/react-core",
  },
  {
    name: "useMakeCopilotDocumentReadable",
    category: "data",
    identityField: null,
    renderProps: null,
    importSource: "@copilotkit/react-core",
  },
  {
    name: "useCopilotChatSuggestions",
    category: "data",
    identityField: null,
    renderProps: null,
    importSource: "@copilotkit/react-core",
  },

  // V2 data hooks
  {
    name: "useAgent",
    category: "data",
    identityField: "name",
    renderProps: null,
    importSource: "@copilotkit/react-core/v2",
  },
  {
    name: "useSuggestions",
    category: "data",
    identityField: null,
    renderProps: null,
    importSource: "@copilotkit/react-core/v2",
  },
  {
    name: "useConfigureSuggestions",
    category: "data",
    identityField: null,
    renderProps: null,
    importSource: "@copilotkit/react-core/v2",
  },
  {
    name: "useThreads",
    category: "data",
    identityField: null,
    renderProps: null,
    importSource: "@copilotkit/react-core/v2",
  },
  {
    name: "useAttachments",
    category: "data",
    identityField: null,
    renderProps: null,
    importSource: "@copilotkit/react-core/v2",
  },
  {
    name: "useAgentContext",
    category: "data",
    identityField: null,
    renderProps: null,
    importSource: "@copilotkit/react-core/v2",
  },
  {
    name: "useCapabilities",
    category: "data",
    identityField: null,
    renderProps: null,
    importSource: "@copilotkit/react-core/v2",
  },
  {
    // `useComponent` wraps `useFrontendTool`: the user's `render` is a
    // ComponentType that receives the tool's `parameters` as props. Same
    // render-tool shape as the underlying hook, so we surface it there.
    name: "useComponent",
    category: "render",
    identityField: "name",
    renderProps: "render-tool",
    importSource: "@copilotkit/react-core/v2",
  },
  {
    // `useDefaultTool` wraps `useCopilotAction({ name: "*" })`, so it uses
    // the V1 action render shape (`{ args, status, result, respond }`).
    name: "useDefaultTool",
    category: "render",
    identityField: "name",
    renderProps: "action",
    importSource: "@copilotkit/react-core/v2",
  },
] as const satisfies ReadonlyArray<HookDef>;

const HOOK_MAP = new Map<string, HookDef>(
  HOOK_REGISTRY.map((h) => [h.name, h]),
);

export const RENDER_HOOK_NAMES: Set<string> = new Set(
  HOOK_REGISTRY.filter((h) => h.category === "render").map((h) => h.name),
);

export function getHookDef(name: string): HookDef | undefined {
  return HOOK_MAP.get(name);
}

export function isRenderHook(name: string): boolean {
  return RENDER_HOOK_NAMES.has(name);
}

export function isCopilotKitHook(name: string): boolean {
  return HOOK_MAP.has(name);
}
