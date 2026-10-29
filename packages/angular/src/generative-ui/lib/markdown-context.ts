import type { CopilotKitCore } from "@copilotkit/core";
import {
  buildGenerativeUIMarkdownGuidelines,
  generativeUIGuideFeatures,
  GENERATIVE_UI_MARKDOWN_GUIDELINES_DESCRIPTION,
  GENERATIVE_UI_MARKDOWN_SCHEMA_CONTEXT_DESCRIPTION,
} from "@copilotkit/shared";
import {
  buildCompactGenerativeUISchema,
  buildGenerativeUIManifest,
} from "@copilotkit/core/generative-ui";
import type { GenerativeUIEngine } from "@copilotkit/core/generative-ui";

/**
 * Registers the two context entries of the markdown transport: the compact
 * component schema and the fence guideline. Both go only to `agentIds`.
 *
 * The schema is built again at each run start and when a
 * `<copilot-generative-ui-surface>` registers, unregisters, or changes its
 * description or its components, so its targets, functions, and surfaces
 * stay current. The surfaces are those of the running thread.
 *
 * @returns Removes the entries and the subscriptions.
 */
export function registerGenerativeUIMarkdownContext(
  core: CopilotKitCore,
  runtime: Pick<GenerativeUIEngine, "ui" | "manager" | "dispatcher">,
  agentIds: string[] | undefined,
): () => void {
  const scope = agentIds ? { agentIds } : {};
  // The guideline has only the rule groups that the manifest uses, and the
  // mounted functions can change, so it is built again with the schema.
  let guidelineId: string | undefined;
  let guidelineValue: string | undefined;
  let schemaId: string | undefined;
  let schemaValue: string | undefined;
  const refreshSchema = (threadId: string | undefined) => {
    const manifest = buildGenerativeUIManifest(runtime, threadId);
    const guideline = buildGenerativeUIMarkdownGuidelines(
      generativeUIGuideFeatures(manifest),
    );
    if (guideline !== guidelineValue) {
      if (guidelineId !== undefined) core.removeContext(guidelineId);
      guidelineValue = guideline;
      guidelineId = core.addContext({
        description: GENERATIVE_UI_MARKDOWN_GUIDELINES_DESCRIPTION,
        value: guideline,
        ...scope,
      });
    }
    const value = JSON.stringify(buildCompactGenerativeUISchema(manifest));
    if (value === schemaValue) return;
    if (schemaId !== undefined) core.removeContext(schemaId);
    schemaValue = value;
    schemaId = core.addContext({
      description: GENERATIVE_UI_MARKDOWN_SCHEMA_CONTEXT_DESCRIPTION,
      value,
      ...scope,
    });
  };
  refreshSchema(runtime.manager.getActiveThread());

  // The manager notifies on every operation. Build the schema again only
  // when the mounted targets, their descriptions, or their component lists
  // change.
  let targetsKey = JSON.stringify(runtime.manager.getMountedTargets());
  const unsubscribeManager = runtime.manager.subscribe(() => {
    const nextKey = JSON.stringify(runtime.manager.getMountedTargets());
    if (nextKey === targetsKey) return;
    targetsKey = nextKey;
    refreshSchema(runtime.manager.getActiveThread());
  });
  // Function handlers can mount at any time. Core reads the context after
  // this callback, so the run gets the current functions and the surfaces
  // of its thread.
  const subscription = core.subscribe({
    onAgentRunStarted: ({ agent }) => refreshSchema(agent.threadId),
  });

  return () => {
    subscription.unsubscribe();
    unsubscribeManager();
    if (guidelineId !== undefined) core.removeContext(guidelineId);
    if (schemaId !== undefined) core.removeContext(schemaId);
  };
}
