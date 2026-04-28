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
  // V2 data: connect to the default agent and get its current state
  useAgent({});

  // V2 data: expose a piece of execution context to the agent
  useAgentContext({
    description: "current user",
    value: { id: "u_1", name: "Alice" },
  });

  // V2 data: read what capabilities the runtime supports
  useCapabilities();

  // V2 data: get the current list of chat suggestions
  useSuggestions({});

  // V2 data: configure how suggestions are generated
  useConfigureSuggestions({
    instructions: "Suggest concise, context-aware follow-up questions.",
  });

  // V2 data: access conversation threads (the playground runtime registers
  // its agent under the name "default", which matches CopilotKitProvider's
  // unconfigured fallback).
  useThreads({ agentId: "default" });

  // V2 data: manage file/image attachments for the current thread
  useAttachments({ config: { enabled: false } });

  return <div>v2 data</div>;
}
