import { useEffect } from "react";
import {
  buildCompactGenerativeUISchema,
  buildGenerativeUIMarkdownGuidelines,
  generativeUIGuideFeatures,
  GENERATIVE_UI_MARKDOWN_GUIDELINES_DESCRIPTION,
  GENERATIVE_UI_MARKDOWN_SCHEMA_CONTEXT_DESCRIPTION,
} from "@copilotkit/shared";
import type { CopilotKitCoreReact } from "../../lib/react-core";
import { buildGenerativeUIManifest } from "../manifest";
import type { GenerativeUIRuntime } from "../runtime-context";

/** The compact schema lives in shared, so tools outside React build the same text. */
export { buildCompactGenerativeUISchema };

/** What the markdown context of the generative UI needs. */
export interface GenerativeUIMarkdownContextOptions {
  /** Register the entries. False for the tool transport or `sendContext: false`. */
  enabled: boolean;
  /** The agents that get the entries. All agents when left out. */
  agentIds: string[] | undefined;
}

/**
 * Registers the two context entries of the markdown transport: the compact
 * component schema and the fence guideline. Both go only to `agentIds`.
 *
 * The schema is built again at each run start and when a
 * `<GenerativeUISurface>` mounts, unmounts, or changes its description or
 * its components, so its targets, functions, and surfaces stay current. The surfaces are those of the running thread.
 *
 * @param copilotkit - The CopilotKit core of the provider.
 * @param runtime - The generative UI runtime parts, or null without one.
 * @param options - `enabled` and `agentIds`.
 *
 * @example
 * ```ts
 * useGenerativeUIMarkdownContext(copilotkit, core, {
 *   enabled: config?.transport === "markdown" && config.sendContext !== false,
 *   agentIds: config?.agentIds,
 * });
 * ```
 */
export function useGenerativeUIMarkdownContext(
  copilotkit: CopilotKitCoreReact,
  runtime: Pick<GenerativeUIRuntime, "ui" | "manager" | "dispatcher"> | null,
  options: GenerativeUIMarkdownContextOptions,
) {
  const { enabled, agentIds } = options;
  // A new array with the same ids must not register the entries again.
  const agentIdsKey = agentIds === undefined ? "" : JSON.stringify(agentIds);

  useEffect(() => {
    if (!runtime || !enabled) return;
    const scopedAgentIds: string[] | undefined = agentIdsKey
      ? JSON.parse(agentIdsKey)
      : undefined;
    const scope = scopedAgentIds ? { agentIds: scopedAgentIds } : {};
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
        if (guidelineId !== undefined) copilotkit.removeContext(guidelineId);
        guidelineValue = guideline;
        guidelineId = copilotkit.addContext({
          description: GENERATIVE_UI_MARKDOWN_GUIDELINES_DESCRIPTION,
          value: guideline,
          ...scope,
        });
      }
      const value = JSON.stringify(buildCompactGenerativeUISchema(manifest));
      if (value === schemaValue) return;
      if (schemaId !== undefined) copilotkit.removeContext(schemaId);
      schemaValue = value;
      schemaId = copilotkit.addContext({
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
    const subscription = copilotkit.subscribe({
      onAgentRunStarted: ({ agent }) => refreshSchema(agent.threadId),
    });

    return () => {
      subscription.unsubscribe();
      unsubscribeManager();
      if (guidelineId !== undefined) copilotkit.removeContext(guidelineId);
      if (schemaId !== undefined) copilotkit.removeContext(schemaId);
    };
  }, [copilotkit, runtime, enabled, agentIdsKey]);
}
