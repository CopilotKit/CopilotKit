import { computed, toValue, watch } from "vue";
import type { MaybeRefOrGetter } from "vue";
import {
  buildCompactGenerativeUISchema,
  buildGenerativeUIMarkdownGuidelines,
  generativeUIGuideFeatures,
  GENERATIVE_UI_MARKDOWN_GUIDELINES_DESCRIPTION,
  GENERATIVE_UI_MARKDOWN_SCHEMA_CONTEXT_DESCRIPTION,
  defaultGenerativeUIPromptSpec,
  renderGenerativeUISchema,
} from "@copilotkit/shared";
import { buildGenerativeUIManifest } from "@copilotkit/core/generative-ui";
import type { GenerativeUIEngine } from "@copilotkit/core/generative-ui";
import type { CopilotKitCoreVue } from "../../lib/vue-core";

/** The compact schema lives in shared, so tools outside Vue build the same text. */
export { buildCompactGenerativeUISchema };

/** What the markdown context of the generative UI needs. */
export interface GenerativeUIMarkdownContextOptions {
  /** Register the entries. False for the tool transport or `sendContext: false`. */
  enabled: MaybeRefOrGetter<boolean>;
  /** The agents that get the entries. All agents when left out. */
  agentIds: MaybeRefOrGetter<string[] | undefined>;
}

/**
 * Registers the two context entries of the markdown transport: the compact
 * component schema and the fence guideline. Both go only to `agentIds`.
 *
 * The schema is built again at each run start and when a
 * `<GenerativeUISurface>` mounts, unmounts, or changes its description or
 * its components, so its targets, functions, and surfaces stay current. The
 * surfaces are those of the running thread. The entries are removed when
 * `enabled` turns false, and when the effect scope is disposed.
 *
 * @param copilotkit - The CopilotKit core of the provider.
 * @param runtime - The generative UI runtime parts, or null without one.
 * @param options - `enabled` and `agentIds`. Both can be refs or getters.
 *
 * @example
 * ```ts
 * useGenerativeUIMarkdownContext(copilotkit, core, {
 *   enabled: () => config()?.transport === "markdown" && config()?.sendContext !== false,
 *   agentIds: () => config()?.agentIds,
 * });
 * ```
 */
export function useGenerativeUIMarkdownContext(
  copilotkit: MaybeRefOrGetter<CopilotKitCoreVue>,
  runtime: MaybeRefOrGetter<Pick<
    GenerativeUIEngine,
    "ui" | "manager" | "dispatcher"
  > | null>,
  options: GenerativeUIMarkdownContextOptions,
) {
  // A new array with the same ids must not register the entries again.
  const agentIdsKey = computed(() => {
    const agentIds = toValue(options.agentIds);
    return agentIds === undefined ? "" : JSON.stringify(agentIds);
  });

  watch(
    [
      () => toValue(copilotkit),
      () => toValue(runtime),
      () => toValue(options.enabled),
      agentIdsKey,
    ],
    ([core, parts, enabled, idsKey], _previous, onCleanup) => {
      if (!parts || !enabled) return;
      const scopedAgentIds: string[] | undefined = idsKey
        ? JSON.parse(idsKey)
        : undefined;
      const scope = scopedAgentIds ? { agentIds: scopedAgentIds } : {};
      // The guideline has only the rule groups that the manifest uses, and
      // the mounted functions can change, so it is built again with the
      // schema.
      let guidelineId: string | undefined;
      let guidelineValue: string | undefined;
      let schemaId: string | undefined;
      let schemaValue: string | undefined;
      const refreshSchema = (threadId: string | undefined) => {
        const manifest = buildGenerativeUIManifest(parts, threadId);
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
        const value = renderGenerativeUISchema(
          manifest,
          defaultGenerativeUIPromptSpec().schema.markdown,
        );
        if (value === schemaValue) return;
        if (schemaId !== undefined) core.removeContext(schemaId);
        schemaValue = value;
        schemaId = core.addContext({
          description: GENERATIVE_UI_MARKDOWN_SCHEMA_CONTEXT_DESCRIPTION,
          value,
          ...scope,
        });
      };
      refreshSchema(parts.manager.getActiveThread());

      // The manager notifies on every operation. Build the schema again only
      // when the mounted targets, their descriptions, or their component
      // lists change.
      let targetsKey = JSON.stringify(parts.manager.getMountedTargets());
      const unsubscribeManager = parts.manager.subscribe(() => {
        const nextKey = JSON.stringify(parts.manager.getMountedTargets());
        if (nextKey === targetsKey) return;
        targetsKey = nextKey;
        refreshSchema(parts.manager.getActiveThread());
      });
      // Function handlers can mount at any time. Core reads the context after
      // this callback, so the run gets the current functions and the surfaces
      // of its thread.
      const subscription = core.subscribe({
        onAgentRunStarted: ({ agent }) => refreshSchema(agent.threadId),
      });

      onCleanup(() => {
        subscription.unsubscribe();
        unsubscribeManager();
        if (guidelineId !== undefined) core.removeContext(guidelineId);
        if (schemaId !== undefined) core.removeContext(schemaId);
      });
    },
    { immediate: true },
  );
}
