// GENERATED FILE — DO NOT EDIT BY HAND.
// Regenerate with: pnpm exec tsx scripts/deprecations/removed-exports.mts generate
//
// Stand-ins for the CopilotKit 1.x exports that 2.0 removed from @copilotkit/react-core.
// Calling, constructing, or rendering one throws a CopilotKitRemovedApiError,
// and importing one does not. TypeScript fails on the same code with the same
// message. The replacements are in packages/shared/src/removed-exports-table.ts.

import { removedApi } from "@copilotkit/shared";
import type { RemovedType } from "@copilotkit/shared";

/** @deprecated "A2UIActionInterceptor" was removed in CopilotKit 2.0. The A2UI v0.9 renderer was removed, and CopilotKitProvider renders A2UI with generative UI. Pass generativeUI={{ ui }} with a UI from createGenerativeUI in @copilotkit/react-core/generative-ui. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/generative-ui-2.0#a2ui-v09-renderer */
export type A2UIActionInterceptor = RemovedType<
  "A2UIActionInterceptor",
  "The A2UI v0.9 renderer was removed, and CopilotKitProvider renders A2UI with generative UI. Pass generativeUI={{ ui }} with a UI from createGenerativeUI in @copilotkit/react-core/generative-ui.",
  "/migrate/generative-ui-2.0#a2ui-v09-renderer"
>;

/** @deprecated "A2UIMessageRendererOptions" was removed in CopilotKit 2.0. The A2UI v0.9 renderer was removed, and CopilotKitProvider renders A2UI with generative UI. Pass generativeUI={{ ui }} with a UI from createGenerativeUI in @copilotkit/react-core/generative-ui. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/generative-ui-2.0#a2ui-v09-renderer */
export type A2UIMessageRendererOptions = RemovedType<
  "A2UIMessageRendererOptions",
  "The A2UI v0.9 renderer was removed, and CopilotKitProvider renders A2UI with generative UI. Pass generativeUI={{ ui }} with a UI from createGenerativeUI in @copilotkit/react-core/generative-ui.",
  "/migrate/generative-ui-2.0#a2ui-v09-renderer"
>;

/** @deprecated "A2UIRecoveryRendererOptions" was removed in CopilotKit 2.0. The A2UI v0.9 renderer was removed, and CopilotKitProvider renders A2UI with generative UI. Pass generativeUI={{ ui }} with a UI from createGenerativeUI in @copilotkit/react-core/generative-ui. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/generative-ui-2.0#a2ui-v09-renderer */
export type A2UIRecoveryRendererOptions = RemovedType<
  "A2UIRecoveryRendererOptions",
  "The A2UI v0.9 renderer was removed, and CopilotKitProvider renders A2UI with generative UI. Pass generativeUI={{ ui }} with a UI from createGenerativeUI in @copilotkit/react-core/generative-ui.",
  "/migrate/generative-ui-2.0#a2ui-v09-renderer"
>;

/** @deprecated "A2UITheme" was removed in CopilotKit 2.0. The A2UI v0.9 renderer was removed, and CopilotKitProvider renders A2UI with generative UI. Pass generativeUI={{ ui }} with a UI from createGenerativeUI in @copilotkit/react-core/generative-ui. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/generative-ui-2.0#a2ui-v09-renderer */
export type A2UITheme = RemovedType<
  "A2UITheme",
  "The A2UI v0.9 renderer was removed, and CopilotKitProvider renders A2UI with generative UI. Pass generativeUI={{ ui }} with a UI from createGenerativeUI in @copilotkit/react-core/generative-ui.",
  "/migrate/generative-ui-2.0#a2ui-v09-renderer"
>;

/** @deprecated "A2UIUserAction" was removed in CopilotKit 2.0. The A2UI v0.9 renderer was removed, and CopilotKitProvider renders A2UI with generative UI. Pass generativeUI={{ ui }} with a UI from createGenerativeUI in @copilotkit/react-core/generative-ui. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/generative-ui-2.0#a2ui-v09-renderer */
export type A2UIUserAction = RemovedType<
  "A2UIUserAction",
  "The A2UI v0.9 renderer was removed, and CopilotKitProvider renders A2UI with generative UI. Pass generativeUI={{ ui }} with a UI from createGenerativeUI in @copilotkit/react-core/generative-ui.",
  "/migrate/generative-ui-2.0#a2ui-v09-renderer"
>;

/** @deprecated "ActionRenderProps" was removed in CopilotKit 2.0. TypeScript infers the render props of useFrontendTool, useHumanInTheLoop, and useRenderTool from @copilotkit/react-core from their parameters schema. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type ActionRenderProps<_T1 = unknown> = RemovedType<
  "ActionRenderProps",
  "TypeScript infers the render props of useFrontendTool, useHumanInTheLoop, and useRenderTool from @copilotkit/react-core from their parameters schema.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "ActionRenderPropsNoArgs" was removed in CopilotKit 2.0. TypeScript infers the render props of useFrontendTool, useHumanInTheLoop, and useRenderTool from @copilotkit/react-core from their parameters schema. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type ActionRenderPropsNoArgs<_T1 = unknown> = RemovedType<
  "ActionRenderPropsNoArgs",
  "TypeScript infers the render props of useFrontendTool, useHumanInTheLoop, and useRenderTool from @copilotkit/react-core from their parameters schema.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "ActionRenderPropsNoArgsWait" was removed in CopilotKit 2.0. TypeScript infers the render props of useFrontendTool, useHumanInTheLoop, and useRenderTool from @copilotkit/react-core from their parameters schema. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type ActionRenderPropsNoArgsWait<_T1 = unknown> = RemovedType<
  "ActionRenderPropsNoArgsWait",
  "TypeScript infers the render props of useFrontendTool, useHumanInTheLoop, and useRenderTool from @copilotkit/react-core from their parameters schema.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "ActionRenderPropsWait" was removed in CopilotKit 2.0. TypeScript infers the render props of useFrontendTool, useHumanInTheLoop, and useRenderTool from @copilotkit/react-core from their parameters schema. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type ActionRenderPropsWait<_T1 = unknown> = RemovedType<
  "ActionRenderPropsWait",
  "TypeScript infers the render props of useFrontendTool, useHumanInTheLoop, and useRenderTool from @copilotkit/react-core from their parameters schema.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "CatchAllActionRenderProps" was removed in CopilotKit 2.0. TypeScript infers the render props of useFrontendTool, useHumanInTheLoop, and useRenderTool from @copilotkit/react-core from their parameters schema. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type CatchAllActionRenderProps<_T1 = unknown> = RemovedType<
  "CatchAllActionRenderProps",
  "TypeScript infers the render props of useFrontendTool, useHumanInTheLoop, and useRenderTool from @copilotkit/react-core from their parameters schema.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "CatchAllActionRenderPropsWait" was removed in CopilotKit 2.0. TypeScript infers the render props of useFrontendTool, useHumanInTheLoop, and useRenderTool from @copilotkit/react-core from their parameters schema. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type CatchAllActionRenderPropsWait<_T1 = unknown> = RemovedType<
  "CatchAllActionRenderPropsWait",
  "TypeScript infers the render props of useFrontendTool, useHumanInTheLoop, and useRenderTool from @copilotkit/react-core from their parameters schema.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "CatchAllFrontendAction" was removed in CopilotKit 2.0. Register a renderer for every tool with useRenderTool({ name: "*", render }) from @copilotkit/react-core. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type CatchAllFrontendAction = RemovedType<
  "CatchAllFrontendAction",
  'Register a renderer for every tool with useRenderTool({ name: "*", render }) from @copilotkit/react-core.',
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "ChatSuggestions" was removed in CopilotKit 2.0. Use SuggestionsConfig from @copilotkit/react-core, the argument of useConfigureSuggestions. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type ChatSuggestions = RemovedType<
  "ChatSuggestions",
  "Use SuggestionsConfig from @copilotkit/react-core, the argument of useConfigureSuggestions.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "CoagentInChatRenderFunction" was removed in CopilotKit 2.0. Use useAgent from @copilotkit/react-core, and render agent.state in your component. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type CoagentInChatRenderFunction = RemovedType<
  "CoagentInChatRenderFunction",
  "Use useAgent from @copilotkit/react-core, and render agent.state in your component.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "CoAgentStateRendersContextValue" was removed in CopilotKit 2.0. Use useAgent from @copilotkit/react-core, and render agent.state in your component. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type CoAgentStateRendersContextValue = RemovedType<
  "CoAgentStateRendersContextValue",
  "Use useAgent from @copilotkit/react-core, and render agent.state in your component.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "CoAgentStateRendersProvider" was removed in CopilotKit 2.0. Delete it. Render agent.state from useAgent from @copilotkit/react-core in your component. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export const CoAgentStateRendersProvider = /*#__PURE__*/ removedApi({
  name: "CoAgentStateRendersProvider",
  use: "Delete it. Render agent.state from useAgent from @copilotkit/react-core in your component.",
  docs: "/migrate/v2#hook-mapping",
});

/** @deprecated "CopilotApiConfig" was removed in CopilotKit 2.0. Pass runtimeUrl and headers to CopilotKitProvider from @copilotkit/react-core. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-provider-and-hook-imports */
export type CopilotApiConfig = RemovedType<
  "CopilotApiConfig",
  "Pass runtimeUrl and headers to CopilotKitProvider from @copilotkit/react-core.",
  "/migrate/v2#update-the-provider-and-hook-imports"
>;

/** @deprecated "CopilotChatSuggestionConfiguration" was removed in CopilotKit 2.0. Use SuggestionsConfig from @copilotkit/react-core, the argument of useConfigureSuggestions. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type CopilotChatSuggestionConfiguration = RemovedType<
  "CopilotChatSuggestionConfiguration",
  "Use SuggestionsConfig from @copilotkit/react-core, the argument of useConfigureSuggestions.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "CopilotContextParams" was removed in CopilotKit 2.0. Use useCopilotKit from @copilotkit/react-core. It returns the CopilotKit core. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/programmatic-control#sending-a-message-from-code */
export type CopilotContextParams = RemovedType<
  "CopilotContextParams",
  "Use useCopilotKit from @copilotkit/react-core. It returns the CopilotKit core.",
  "/programmatic-control#sending-a-message-from-code"
>;

/** @deprecated "CopilotMessagesContextParams" was removed in CopilotKit 2.0. Read agent.messages from useAgent from @copilotkit/react-core. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type CopilotMessagesContextParams = RemovedType<
  "CopilotMessagesContextParams",
  "Read agent.messages from useAgent from @copilotkit/react-core.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "CopilotTask" was removed in CopilotKit 2.0. Run the agent from code: add a message with agent.addMessage from useAgent, then call copilotkit.runAgent({ agent }) from useCopilotKit, both from @copilotkit/react-core. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/programmatic-control#sending-a-message-from-code */
export const CopilotTask = /*#__PURE__*/ removedApi({
  name: "CopilotTask",
  use: "Run the agent from code: add a message with agent.addMessage from useAgent, then call copilotkit.runAgent({ agent }) from useCopilotKit, both from @copilotkit/react-core.",
  docs: "/programmatic-control#sending-a-message-from-code",
});
/** @deprecated "CopilotTask" was removed in CopilotKit 2.0. Run the agent from code: add a message with agent.addMessage from useAgent, then call copilotkit.runAgent({ agent }) from useCopilotKit, both from @copilotkit/react-core. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/programmatic-control#sending-a-message-from-code */
export type CopilotTask<_T1 = unknown> = typeof CopilotTask;

/** @deprecated "CopilotTaskConfig" was removed in CopilotKit 2.0. Run the agent from code: add a message with agent.addMessage from useAgent, then call copilotkit.runAgent({ agent }) from useCopilotKit, both from @copilotkit/react-core. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/programmatic-control#sending-a-message-from-code */
export type CopilotTaskConfig = RemovedType<
  "CopilotTaskConfig",
  "Run the agent from code: add a message with agent.addMessage from useAgent, then call copilotkit.runAgent({ agent }) from useCopilotKit, both from @copilotkit/react-core.",
  "/programmatic-control#sending-a-message-from-code"
>;

/** @deprecated "createA2UIMessageRenderer" was removed in CopilotKit 2.0. The A2UI v0.9 renderer was removed, and CopilotKitProvider renders A2UI with generative UI. Pass generativeUI={{ ui }} with a UI from createGenerativeUI in @copilotkit/react-core/generative-ui. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/generative-ui-2.0#a2ui-v09-renderer */
export const createA2UIMessageRenderer = /*#__PURE__*/ removedApi({
  name: "createA2UIMessageRenderer",
  use: "The A2UI v0.9 renderer was removed, and CopilotKitProvider renders A2UI with generative UI. Pass generativeUI={{ ui }} with a UI from createGenerativeUI in @copilotkit/react-core/generative-ui.",
  docs: "/migrate/generative-ui-2.0#a2ui-v09-renderer",
});

/** @deprecated "CrewsAgentState" was removed in CopilotKit 2.0. Read the agent state with useAgent from @copilotkit/react-core, and declare its type in your app. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type CrewsAgentState = RemovedType<
  "CrewsAgentState",
  "Read the agent state with useAgent from @copilotkit/react-core, and declare its type in your app.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "CrewsResponse" was removed in CopilotKit 2.0. Read the agent state with useAgent from @copilotkit/react-core, and declare its type in your app. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type CrewsResponse = RemovedType<
  "CrewsResponse",
  "Read the agent state with useAgent from @copilotkit/react-core, and declare its type in your app.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "CrewsResponseStatus" was removed in CopilotKit 2.0. Read the agent state with useAgent from @copilotkit/react-core, and declare its type in your app. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type CrewsResponseStatus = RemovedType<
  "CrewsResponseStatus",
  "Read the agent state with useAgent from @copilotkit/react-core, and declare its type in your app.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "CrewsStateItem" was removed in CopilotKit 2.0. Read the agent state with useAgent from @copilotkit/react-core, and declare its type in your app. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type CrewsStateItem = RemovedType<
  "CrewsStateItem",
  "Read the agent state with useAgent from @copilotkit/react-core, and declare its type in your app.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "CrewsTaskStateItem" was removed in CopilotKit 2.0. Read the agent state with useAgent from @copilotkit/react-core, and declare its type in your app. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type CrewsTaskStateItem = RemovedType<
  "CrewsTaskStateItem",
  "Read the agent state with useAgent from @copilotkit/react-core, and declare its type in your app.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "CrewsToolStateItem" was removed in CopilotKit 2.0. Read the agent state with useAgent from @copilotkit/react-core, and declare its type in your app. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type CrewsToolStateItem = RemovedType<
  "CrewsToolStateItem",
  "Read the agent state with useAgent from @copilotkit/react-core, and declare its type in your app.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "DocumentPointer" was removed in CopilotKit 2.0. Pass the data to useAgentContext from @copilotkit/react-core. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type DocumentPointer = RemovedType<
  "DocumentPointer",
  "Pass the data to useAgentContext from @copilotkit/react-core.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "FrontendAction" was removed in CopilotKit 2.0. Use ReactFrontendTool from @copilotkit/react-core, the argument of useFrontendTool. Its parameters is a Zod 4 / Standard Schema. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type FrontendAction<_T1 = unknown, _T2 = unknown> = RemovedType<
  "FrontendAction",
  "Use ReactFrontendTool from @copilotkit/react-core, the argument of useFrontendTool. Its parameters is a Zod 4 / Standard Schema.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "FrontendActionAvailability" was removed in CopilotKit 2.0. Set available on useFrontendTool from @copilotkit/react-core to true or false. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type FrontendActionAvailability = RemovedType<
  "FrontendActionAvailability",
  "Set available on useFrontendTool from @copilotkit/react-core to true or false.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "HintFunction" was removed in CopilotKit 2.0. Run the agent from code: add a message with agent.addMessage from useAgent, then call copilotkit.runAgent({ agent }) from useCopilotKit, both from @copilotkit/react-core. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/programmatic-control#sending-a-message-from-code */
export type HintFunction = RemovedType<
  "HintFunction",
  "Run the agent from code: add a message with agent.addMessage from useAgent, then call copilotkit.runAgent({ agent }) from useCopilotKit, both from @copilotkit/react-core.",
  "/programmatic-control#sending-a-message-from-code"
>;

/** @deprecated "LangGraphInterruptAction" was removed in CopilotKit 2.0. Use useInterrupt from @copilotkit/react-core, with its UseInterruptConfig, InterruptRenderProps, and InterruptHandlerProps types. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type LangGraphInterruptAction = RemovedType<
  "LangGraphInterruptAction",
  "Use useInterrupt from @copilotkit/react-core, with its UseInterruptConfig, InterruptRenderProps, and InterruptHandlerProps types.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "LangGraphInterruptActionSetter" was removed in CopilotKit 2.0. Use useInterrupt from @copilotkit/react-core, with its UseInterruptConfig, InterruptRenderProps, and InterruptHandlerProps types. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type LangGraphInterruptActionSetter = RemovedType<
  "LangGraphInterruptActionSetter",
  "Use useInterrupt from @copilotkit/react-core, with its UseInterruptConfig, InterruptRenderProps, and InterruptHandlerProps types.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "LangGraphInterruptActionSetterArgs" was removed in CopilotKit 2.0. Use useInterrupt from @copilotkit/react-core, with its UseInterruptConfig, InterruptRenderProps, and InterruptHandlerProps types. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type LangGraphInterruptActionSetterArgs = RemovedType<
  "LangGraphInterruptActionSetterArgs",
  "Use useInterrupt from @copilotkit/react-core, with its UseInterruptConfig, InterruptRenderProps, and InterruptHandlerProps types.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "LangGraphInterruptRender" was removed in CopilotKit 2.0. Use useInterrupt from @copilotkit/react-core, with its UseInterruptConfig, InterruptRenderProps, and InterruptHandlerProps types. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type LangGraphInterruptRender<_T1 = unknown> = RemovedType<
  "LangGraphInterruptRender",
  "Use useInterrupt from @copilotkit/react-core, with its UseInterruptConfig, InterruptRenderProps, and InterruptHandlerProps types.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "LangGraphInterruptRenderHandlerProps" was removed in CopilotKit 2.0. Use useInterrupt from @copilotkit/react-core, with its UseInterruptConfig, InterruptRenderProps, and InterruptHandlerProps types. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type LangGraphInterruptRenderHandlerProps<_T1 = unknown> = RemovedType<
  "LangGraphInterruptRenderHandlerProps",
  "Use useInterrupt from @copilotkit/react-core, with its UseInterruptConfig, InterruptRenderProps, and InterruptHandlerProps types.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "LangGraphInterruptRenderProps" was removed in CopilotKit 2.0. Use useInterrupt from @copilotkit/react-core, with its UseInterruptConfig, InterruptRenderProps, and InterruptHandlerProps types. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type LangGraphInterruptRenderProps<_T1 = unknown> = RemovedType<
  "LangGraphInterruptRenderProps",
  "Use useInterrupt from @copilotkit/react-core, with its UseInterruptConfig, InterruptRenderProps, and InterruptHandlerProps types.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "OnReloadMessages" was removed in CopilotKit 2.0. Configure the chat with the props and slots of CopilotChat from @copilotkit/react-core. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#replace-react-ui-imports */
export type OnReloadMessages = RemovedType<
  "OnReloadMessages",
  "Configure the chat with the props and slots of CopilotChat from @copilotkit/react-core.",
  "/migrate/v2#replace-react-ui-imports"
>;

/** @deprecated "OnStopGeneration" was removed in CopilotKit 2.0. Configure the chat with the props and slots of CopilotChat from @copilotkit/react-core. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#replace-react-ui-imports */
export type OnStopGeneration = RemovedType<
  "OnStopGeneration",
  "Configure the chat with the props and slots of CopilotChat from @copilotkit/react-core.",
  "/migrate/v2#replace-react-ui-imports"
>;

/** @deprecated "QueuedInterruptEvent" was removed in CopilotKit 2.0. Use useInterrupt from @copilotkit/react-core, with its UseInterruptConfig, InterruptRenderProps, and InterruptHandlerProps types. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type QueuedInterruptEvent = RemovedType<
  "QueuedInterruptEvent",
  "Use useInterrupt from @copilotkit/react-core, with its UseInterruptConfig, InterruptRenderProps, and InterruptHandlerProps types.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "RenderFunctionStatus" was removed in CopilotKit 2.0. Use ToolCallStatus from @copilotkit/react-core. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type RenderFunctionStatus = RemovedType<
  "RenderFunctionStatus",
  "Use ToolCallStatus from @copilotkit/react-core.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "shouldShowDevConsole" was removed in CopilotKit 2.0. Delete the call. To turn the Inspector on or off, set enableInspector on CopilotKitProvider. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/removed-apis-2.0#showdevconsole */
export const shouldShowDevConsole = /*#__PURE__*/ removedApi({
  name: "shouldShowDevConsole",
  use: "Delete the call. To turn the Inspector on or off, set enableInspector on CopilotKitProvider.",
  docs: "/migrate/removed-apis-2.0#showdevconsole",
});

/** @deprecated "SystemMessageFunction" was removed in CopilotKit 2.0. Give the agent its instructions in the agent, or with useAgentContext from @copilotkit/react-core. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type SystemMessageFunction = RemovedType<
  "SystemMessageFunction",
  "Give the agent its instructions in the agent, or with useAgentContext from @copilotkit/react-core.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "ThreadsContextValue" was removed in CopilotKit 2.0. Use useThreads from @copilotkit/react-core. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/chat-2.0#thread-lists */
export type ThreadsContextValue = RemovedType<
  "ThreadsContextValue",
  "Use useThreads from @copilotkit/react-core.",
  "/migrate/chat-2.0#thread-lists"
>;

/** @deprecated "ThreadsProvider" was removed in CopilotKit 2.0. Delete it. Pass threadId to CopilotChat (or to CopilotChatConfigurationProvider around the chat), and list the threads with useThreads, from @copilotkit/react-core. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/chat-2.0#thread-lists */
export const ThreadsProvider = /*#__PURE__*/ removedApi({
  name: "ThreadsProvider",
  use: "Delete it. Pass threadId to CopilotChat (or to CopilotChatConfigurationProvider around the chat), and list the threads with useThreads, from @copilotkit/react-core.",
  docs: "/migrate/chat-2.0#thread-lists",
});

/** @deprecated "ThreadsProviderProps" was removed in CopilotKit 2.0. Use useThreads from @copilotkit/react-core. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/chat-2.0#thread-lists */
export type ThreadsProviderProps = RemovedType<
  "ThreadsProviderProps",
  "Use useThreads from @copilotkit/react-core.",
  "/migrate/chat-2.0#thread-lists"
>;

/** @deprecated "Tree" was removed in CopilotKit 2.0. Pass the data to useAgentContext from @copilotkit/react-core. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type Tree = RemovedType<
  "Tree",
  "Pass the data to useAgentContext from @copilotkit/react-core.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "TreeNode" was removed in CopilotKit 2.0. Pass the data to useAgentContext from @copilotkit/react-core. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type TreeNode = RemovedType<
  "TreeNode",
  "Pass the data to useAgentContext from @copilotkit/react-core.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "useCoAgent" was removed in CopilotKit 2.0. Use useAgent from @copilotkit/react-core. It returns the agent, with its messages and its state. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export const useCoAgent = /*#__PURE__*/ removedApi({
  name: "useCoAgent",
  use: "Use useAgent from @copilotkit/react-core. It returns the agent, with its messages and its state.",
  docs: "/migrate/v2#hook-mapping",
});

/** @deprecated "useCoAgentStateRender" was removed in CopilotKit 2.0. Use useAgent from @copilotkit/react-core, and render agent.state in your component. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export const useCoAgentStateRender = /*#__PURE__*/ removedApi({
  name: "useCoAgentStateRender",
  use: "Use useAgent from @copilotkit/react-core, and render agent.state in your component.",
  docs: "/migrate/v2#hook-mapping",
});

/** @deprecated "useCoAgentStateRenders" was removed in CopilotKit 2.0. Use useAgent from @copilotkit/react-core, and render agent.state in your component. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export const useCoAgentStateRenders = /*#__PURE__*/ removedApi({
  name: "useCoAgentStateRenders",
  use: "Use useAgent from @copilotkit/react-core, and render agent.state in your component.",
  docs: "/migrate/v2#hook-mapping",
});

/** @deprecated "useCopilotAction" was removed in CopilotKit 2.0. Use useFrontendTool from @copilotkit/react-core (parameters are now a Zod 4 / Standard Schema), or useHumanInTheLoop when the action waits for the user. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export const useCopilotAction = /*#__PURE__*/ removedApi({
  name: "useCopilotAction",
  use: "Use useFrontendTool from @copilotkit/react-core (parameters are now a Zod 4 / Standard Schema), or useHumanInTheLoop when the action waits for the user.",
  docs: "/migrate/v2#hook-mapping",
});

/** @deprecated "useCopilotAdditionalInstructions" was removed in CopilotKit 2.0. Use useAgentContext from @copilotkit/react-core to give the agent the instructions. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export const useCopilotAdditionalInstructions = /*#__PURE__*/ removedApi({
  name: "useCopilotAdditionalInstructions",
  use: "Use useAgentContext from @copilotkit/react-core to give the agent the instructions.",
  docs: "/migrate/v2#hook-mapping",
});

/** @deprecated "useCopilotAuthenticatedAction_c" was removed in CopilotKit 2.0. Use useFrontendTool from @copilotkit/react-core, and check the user in its handler. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export const useCopilotAuthenticatedAction_c = /*#__PURE__*/ removedApi({
  name: "useCopilotAuthenticatedAction_c",
  use: "Use useFrontendTool from @copilotkit/react-core, and check the user in its handler.",
  docs: "/migrate/v2#hook-mapping",
});

/** @deprecated "useCopilotChat" was removed in CopilotKit 2.0. Use useAgent from @copilotkit/react-core. It returns the agent with its messages. For a chat UI of your own, see Headless UI. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export const useCopilotChat = /*#__PURE__*/ removedApi({
  name: "useCopilotChat",
  use: "Use useAgent from @copilotkit/react-core. It returns the agent with its messages. For a chat UI of your own, see Headless UI.",
  docs: "/migrate/v2#hook-mapping",
});

/** @deprecated "useCopilotChatHeadless_c" was removed in CopilotKit 2.0. Use useAgent from @copilotkit/react-core. It returns the agent, with its messages and its state. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export const useCopilotChatHeadless_c = /*#__PURE__*/ removedApi({
  name: "useCopilotChatHeadless_c",
  use: "Use useAgent from @copilotkit/react-core. It returns the agent, with its messages and its state.",
  docs: "/migrate/v2#hook-mapping",
});

/** @deprecated "useCopilotChatInternal" was removed in CopilotKit 2.0. Use useAgent from @copilotkit/react-core. It returns the agent, with its messages and its state. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export const useCopilotChatInternal = /*#__PURE__*/ removedApi({
  name: "useCopilotChatInternal",
  use: "Use useAgent from @copilotkit/react-core. It returns the agent, with its messages and its state.",
  docs: "/migrate/v2#hook-mapping",
});

/** @deprecated "UseCopilotChatOptions" was removed in CopilotKit 2.0. Use useAgent from @copilotkit/react-core. It returns the agent, with its messages and its state. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type UseCopilotChatOptions = RemovedType<
  "UseCopilotChatOptions",
  "Use useAgent from @copilotkit/react-core. It returns the agent, with its messages and its state.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "UseCopilotChatOptions_c" was removed in CopilotKit 2.0. Use useAgent from @copilotkit/react-core. It returns the agent, with its messages and its state. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type UseCopilotChatOptions_c = RemovedType<
  "UseCopilotChatOptions_c",
  "Use useAgent from @copilotkit/react-core. It returns the agent, with its messages and its state.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "UseCopilotChatReturn" was removed in CopilotKit 2.0. Use useAgent from @copilotkit/react-core. It returns the agent, with its messages and its state. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type UseCopilotChatReturn = RemovedType<
  "UseCopilotChatReturn",
  "Use useAgent from @copilotkit/react-core. It returns the agent, with its messages and its state.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "UseCopilotChatReturn_c" was removed in CopilotKit 2.0. Use useAgent from @copilotkit/react-core. It returns the agent, with its messages and its state. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type UseCopilotChatReturn_c = RemovedType<
  "UseCopilotChatReturn_c",
  "Use useAgent from @copilotkit/react-core. It returns the agent, with its messages and its state.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "useCopilotChatSuggestions" was removed in CopilotKit 2.0. Use useConfigureSuggestions from @copilotkit/react-core. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export const useCopilotChatSuggestions = /*#__PURE__*/ removedApi({
  name: "useCopilotChatSuggestions",
  use: "Use useConfigureSuggestions from @copilotkit/react-core.",
  docs: "/migrate/v2#hook-mapping",
});

/** @deprecated "UseCopilotChatSuggestionsConfiguration" was removed in CopilotKit 2.0. Use SuggestionsConfig from @copilotkit/react-core, the argument of useConfigureSuggestions. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export type UseCopilotChatSuggestionsConfiguration = RemovedType<
  "UseCopilotChatSuggestionsConfiguration",
  "Use SuggestionsConfig from @copilotkit/react-core, the argument of useConfigureSuggestions.",
  "/migrate/v2#hook-mapping"
>;

/** @deprecated "useCopilotContext" was removed in CopilotKit 2.0. Use useCopilotKit from @copilotkit/react-core. It returns the CopilotKit core. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/programmatic-control#sending-a-message-from-code */
export const useCopilotContext = /*#__PURE__*/ removedApi({
  name: "useCopilotContext",
  use: "Use useCopilotKit from @copilotkit/react-core. It returns the CopilotKit core.",
  docs: "/programmatic-control#sending-a-message-from-code",
});

/** @deprecated "useCopilotMessagesContext" was removed in CopilotKit 2.0. Read agent.messages from useAgent from @copilotkit/react-core. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export const useCopilotMessagesContext = /*#__PURE__*/ removedApi({
  name: "useCopilotMessagesContext",
  use: "Read agent.messages from useAgent from @copilotkit/react-core.",
  docs: "/migrate/v2#hook-mapping",
});

/** @deprecated "useCopilotReadable" was removed in CopilotKit 2.0. Use useAgentContext from @copilotkit/react-core. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export const useCopilotReadable = /*#__PURE__*/ removedApi({
  name: "useCopilotReadable",
  use: "Use useAgentContext from @copilotkit/react-core.",
  docs: "/migrate/v2#hook-mapping",
});

/** @deprecated "useCopilotRuntimeClient" was removed in CopilotKit 2.0. CopilotKit 2.0 has no GraphQL runtime client. Use useAgent or useCopilotKit from @copilotkit/react-core. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export const useCopilotRuntimeClient = /*#__PURE__*/ removedApi({
  name: "useCopilotRuntimeClient",
  use: "CopilotKit 2.0 has no GraphQL runtime client. Use useAgent or useCopilotKit from @copilotkit/react-core.",
  docs: "/migrate/v2#update-the-runtime",
});

/** @deprecated "useDefaultTool" was removed in CopilotKit 2.0. Use useDefaultRenderTool from @copilotkit/react-core. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export const useDefaultTool = /*#__PURE__*/ removedApi({
  name: "useDefaultTool",
  use: "Use useDefaultRenderTool from @copilotkit/react-core.",
  docs: "/migrate/v2#hook-mapping",
});

/** @deprecated "useLangGraphInterrupt" was removed in CopilotKit 2.0. Use useInterrupt from @copilotkit/react-core. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export const useLangGraphInterrupt = /*#__PURE__*/ removedApi({
  name: "useLangGraphInterrupt",
  use: "Use useInterrupt from @copilotkit/react-core.",
  docs: "/migrate/v2#hook-mapping",
});

/** @deprecated "useLazyToolRenderer" was removed in CopilotKit 2.0. Use useRenderToolCall from @copilotkit/react-core. It returns a function that renders a tool call. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#gotchas */
export const useLazyToolRenderer = /*#__PURE__*/ removedApi({
  name: "useLazyToolRenderer",
  use: "Use useRenderToolCall from @copilotkit/react-core. It returns a function that renders a tool call.",
  docs: "/migrate/v2#gotchas",
});

/** @deprecated "useLearningContainers" was removed in CopilotKit 2.0. Set getLearningContainerId on CopilotKitIntelligence from @copilotkit/runtime. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/chat-2.0#removed-exports */
export const useLearningContainers = /*#__PURE__*/ removedApi({
  name: "useLearningContainers",
  use: "Set getLearningContainerId on CopilotKitIntelligence from @copilotkit/runtime.",
  docs: "/migrate/chat-2.0#removed-exports",
});

/** @deprecated "UseLearningContainersArgs" was removed in CopilotKit 2.0. Set getLearningContainerId on CopilotKitIntelligence from @copilotkit/runtime. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/chat-2.0#removed-exports */
export type UseLearningContainersArgs = RemovedType<
  "UseLearningContainersArgs",
  "Set getLearningContainerId on CopilotKitIntelligence from @copilotkit/runtime.",
  "/migrate/chat-2.0#removed-exports"
>;

/** @deprecated "useLearningContainersInCurrentThread" was removed in CopilotKit 2.0. Set getLearningContainerId on CopilotKitIntelligence from @copilotkit/runtime. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/chat-2.0#removed-exports */
export const useLearningContainersInCurrentThread = /*#__PURE__*/ removedApi({
  name: "useLearningContainersInCurrentThread",
  use: "Set getLearningContainerId on CopilotKitIntelligence from @copilotkit/runtime.",
  docs: "/migrate/chat-2.0#removed-exports",
});

/** @deprecated "UseLearningContainersInCurrentThreadArgs" was removed in CopilotKit 2.0. Set getLearningContainerId on CopilotKitIntelligence from @copilotkit/runtime. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/chat-2.0#removed-exports */
export type UseLearningContainersInCurrentThreadArgs = RemovedType<
  "UseLearningContainersInCurrentThreadArgs",
  "Set getLearningContainerId on CopilotKitIntelligence from @copilotkit/runtime.",
  "/migrate/chat-2.0#removed-exports"
>;

/** @deprecated "useMakeCopilotDocumentReadable" was removed in CopilotKit 2.0. Use useAgentContext from @copilotkit/react-core, with the document text as the value. Run `npx codemod @copilotkit/v2-migration` to update your code. See https://docs.copilotkit.ai/migrate/v2#hook-mapping */
export const useMakeCopilotDocumentReadable = /*#__PURE__*/ removedApi({
  name: "useMakeCopilotDocumentReadable",
  use: "Use useAgentContext from @copilotkit/react-core, with the document text as the value.",
  docs: "/migrate/v2#hook-mapping",
});
