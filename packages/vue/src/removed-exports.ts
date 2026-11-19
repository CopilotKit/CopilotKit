// GENERATED FILE — DO NOT EDIT BY HAND.
// Regenerate with: pnpm exec tsx scripts/deprecations/removed-exports.mts generate
//
// Stand-ins for the CopilotKit 1.x exports that 2.0 removed from @copilotkit/vue.
// Calling, constructing, or rendering one throws a CopilotKitRemovedApiError,
// and importing one does not. TypeScript fails on the same code with the same
// message. The replacements are in packages/shared/src/removed-exports-table.ts.

import { removedApi } from "@copilotkit/shared";
import type { RemovedType } from "@copilotkit/shared";

/** @deprecated "A2UIMessageRendererOptions" was removed in CopilotKit 2.0. The A2UI v0.9 renderer was removed, and CopilotKitProvider renders A2UI with generative UI. Pass :generativeUI="{ ui }" with a UI from createGenerativeUI in @copilotkit/vue/generative-ui. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/generative-ui-2.0#a2ui-v09-renderer */
export type A2UIMessageRendererOptions = RemovedType<
  "A2UIMessageRendererOptions",
  'The A2UI v0.9 renderer was removed, and CopilotKitProvider renders A2UI with generative UI. Pass :generativeUI="{ ui }" with a UI from createGenerativeUI in @copilotkit/vue/generative-ui.',
  "/migrate/generative-ui-2.0#a2ui-v09-renderer"
>;

/** @deprecated "A2UIOperation" was removed in CopilotKit 2.0. Import A2UIOperation from @copilotkit/shared. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/generative-ui-2.0#a2ui-v09-renderer */
export type A2UIOperation = RemovedType<
  "A2UIOperation",
  "Import A2UIOperation from @copilotkit/shared.",
  "/migrate/generative-ui-2.0#a2ui-v09-renderer"
>;

/** @deprecated "A2UISurfaceActivityRenderer" was removed in CopilotKit 2.0. The A2UI v0.9 renderer was removed, and CopilotKitProvider renders A2UI with generative UI. Pass :generativeUI="{ ui }" with a UI from createGenerativeUI in @copilotkit/vue/generative-ui. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/generative-ui-2.0#a2ui-v09-renderer */
export const A2UISurfaceActivityRenderer = /*#__PURE__*/ removedApi({
  name: "A2UISurfaceActivityRenderer",
  use: 'The A2UI v0.9 renderer was removed, and CopilotKitProvider renders A2UI with generative UI. Pass :generativeUI="{ ui }" with a UI from createGenerativeUI in @copilotkit/vue/generative-ui.',
  docs: "/migrate/generative-ui-2.0#a2ui-v09-renderer",
});
/** @deprecated "A2UISurfaceActivityRenderer" was removed in CopilotKit 2.0. The A2UI v0.9 renderer was removed, and CopilotKitProvider renders A2UI with generative UI. Pass :generativeUI="{ ui }" with a UI from createGenerativeUI in @copilotkit/vue/generative-ui. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/generative-ui-2.0#a2ui-v09-renderer */
export type A2UISurfaceActivityRenderer = typeof A2UISurfaceActivityRenderer;

/** @deprecated "A2UISurfaceOperationPayload" was removed in CopilotKit 2.0. The A2UI v0.9 renderer was removed, and CopilotKitProvider renders A2UI with generative UI. Pass :generativeUI="{ ui }" with a UI from createGenerativeUI in @copilotkit/vue/generative-ui. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/generative-ui-2.0#a2ui-v09-renderer */
export type A2UISurfaceOperationPayload = RemovedType<
  "A2UISurfaceOperationPayload",
  'The A2UI v0.9 renderer was removed, and CopilotKitProvider renders A2UI with generative UI. Pass :generativeUI="{ ui }" with a UI from createGenerativeUI in @copilotkit/vue/generative-ui.',
  "/migrate/generative-ui-2.0#a2ui-v09-renderer"
>;

/** @deprecated "A2UITheme" was removed in CopilotKit 2.0. The A2UI v0.9 renderer was removed, and CopilotKitProvider renders A2UI with generative UI. Pass :generativeUI="{ ui }" with a UI from createGenerativeUI in @copilotkit/vue/generative-ui. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/generative-ui-2.0#a2ui-v09-renderer */
export type A2UITheme = RemovedType<
  "A2UITheme",
  'The A2UI v0.9 renderer was removed, and CopilotKitProvider renders A2UI with generative UI. Pass :generativeUI="{ ui }" with a UI from createGenerativeUI in @copilotkit/vue/generative-ui.',
  "/migrate/generative-ui-2.0#a2ui-v09-renderer"
>;

/** @deprecated "CatchAllFrontendAction" was removed in CopilotKit 2.0. Register the renderer with useRenderTool({ name: "*", render }) from @copilotkit/vue. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#if-you-use-vue-update-vue-imports */
export type CatchAllFrontendAction = RemovedType<
  "CatchAllFrontendAction",
  'Register the renderer with useRenderTool({ name: "*", render }) from @copilotkit/vue.',
  "/migrate/v2#if-you-use-vue-update-vue-imports"
>;

/** @deprecated "createA2UIMessageRenderer" was removed in CopilotKit 2.0. The A2UI v0.9 renderer was removed, and CopilotKitProvider renders A2UI with generative UI. Pass :generativeUI="{ ui }" with a UI from createGenerativeUI in @copilotkit/vue/generative-ui. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/generative-ui-2.0#a2ui-v09-renderer */
export const createA2UIMessageRenderer = /*#__PURE__*/ removedApi({
  name: "createA2UIMessageRenderer",
  use: 'The A2UI v0.9 renderer was removed, and CopilotKitProvider renders A2UI with generative UI. Pass :generativeUI="{ ui }" with a UI from createGenerativeUI in @copilotkit/vue/generative-ui.',
  docs: "/migrate/generative-ui-2.0#a2ui-v09-renderer",
});

/** @deprecated "FrontendAction" was removed in CopilotKit 2.0. Use VueFrontendTool from @copilotkit/vue. Its parameters is a Zod schema, and available is a boolean. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#if-you-use-vue-update-vue-imports */
export type FrontendAction<_T1 = unknown> = RemovedType<
  "FrontendAction",
  "Use VueFrontendTool from @copilotkit/vue. Its parameters is a Zod schema, and available is a boolean.",
  "/migrate/v2#if-you-use-vue-update-vue-imports"
>;

/** @deprecated "getOperationSurfaceId" was removed in CopilotKit 2.0. Import getOperationSurfaceId from @copilotkit/shared. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/generative-ui-2.0#a2ui-v09-renderer */
export const getOperationSurfaceId = /*#__PURE__*/ removedApi({
  name: "getOperationSurfaceId",
  use: "Import getOperationSurfaceId from @copilotkit/shared.",
  docs: "/migrate/generative-ui-2.0#a2ui-v09-renderer",
});

/** @deprecated "useCopilotAction" was removed in CopilotKit 2.0. Use useFrontendTool from @copilotkit/vue (parameters are now a Zod 4 / Standard Schema), useHumanInTheLoop for renderAndWaitForResponse, or useRenderTool for an action that only renders. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#if-you-use-vue-update-vue-imports */
export const useCopilotAction = /*#__PURE__*/ removedApi({
  name: "useCopilotAction",
  use: "Use useFrontendTool from @copilotkit/vue (parameters are now a Zod 4 / Standard Schema), useHumanInTheLoop for renderAndWaitForResponse, or useRenderTool for an action that only renders.",
  docs: "/migrate/v2#if-you-use-vue-update-vue-imports",
});

/** @deprecated "useCopilotReadable" was removed in CopilotKit 2.0. Use useAgentContext from @copilotkit/vue. To keep the context current, pass a ref, a getter, or a reactive object as the value. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#if-you-use-vue-update-vue-imports */
export const useCopilotReadable = /*#__PURE__*/ removedApi({
  name: "useCopilotReadable",
  use: "Use useAgentContext from @copilotkit/vue. To keep the context current, pass a ref, a getter, or a reactive object as the value.",
  docs: "/migrate/v2#if-you-use-vue-update-vue-imports",
});

/** @deprecated "UseCopilotReadableOptions" was removed in CopilotKit 2.0. Use AgentContextInput from @copilotkit/vue: { description, value }. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#if-you-use-vue-update-vue-imports */
export type UseCopilotReadableOptions = RemovedType<
  "UseCopilotReadableOptions",
  "Use AgentContextInput from @copilotkit/vue: { description, value }.",
  "/migrate/v2#if-you-use-vue-update-vue-imports"
>;

/** @deprecated "UseFrontendToolArgs" was removed in CopilotKit 2.0. Use VueFrontendTool from @copilotkit/vue. Its parameters is a Zod schema, and available is a boolean. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#if-you-use-vue-update-vue-imports */
export type UseFrontendToolArgs<_T1 = unknown> = RemovedType<
  "UseFrontendToolArgs",
  "Use VueFrontendTool from @copilotkit/vue. Its parameters is a Zod schema, and available is a boolean.",
  "/migrate/v2#if-you-use-vue-update-vue-imports"
>;

/** @deprecated "useKatexStyles" was removed in CopilotKit 2.0. Delete the import and the call. The 2.0 chat does not render KaTeX math; to render math, plug in a markdown renderer of your own. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/markdown-rendering#option-3--replace-the-renderer-escape-hatch */
export const useKatexStyles = /*#__PURE__*/ removedApi({
  name: "useKatexStyles",
  use: "Delete the import and the call. The 2.0 chat does not render KaTeX math; to render math, plug in a markdown renderer of your own.",
  docs: "/markdown-rendering#option-3--replace-the-renderer-escape-hatch",
});
