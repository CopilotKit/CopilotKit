import {
  useAgent,
  useAgentContext,
  useCapabilities,
  useSuggestions,
  useConfigureSuggestions,
  useThreads,
  useAttachments,
} from "@copilotkit/react-core/v2";

export function Data() {
  // V2 data: connect to a named agent and get its current state
  // @ts-expect-error – test-workspace only
  useAgent({ name: "main" });

  // V2 data: read the current agent's execution context
  // @ts-expect-error – test-workspace only
  useAgentContext();

  // V2 data: read what capabilities the runtime supports
  // @ts-expect-error – test-workspace only
  useCapabilities();

  // V2 data: get the current list of chat suggestions
  // @ts-expect-error – test-workspace only
  useSuggestions();

  // V2 data: configure how suggestions are generated
  // @ts-expect-error – test-workspace only
  useConfigureSuggestions({
    instructions: "Suggest concise, context-aware follow-up questions.",
  });

  // V2 data: access conversation threads
  // @ts-expect-error – test-workspace only
  useThreads();

  // V2 data: manage file/image attachments for the current thread
  // @ts-expect-error – test-workspace only
  useAttachments();

  return <div>v2 data</div>;
}
