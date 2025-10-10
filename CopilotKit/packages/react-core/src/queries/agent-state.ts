// CopilotKit/packages/react-core/src/queries/agent-state.ts
import { useQuery, QueryKey } from "@tanstack/react-query";
import { loadMessagesFromJsonRepresentation, Message } from "@copilotkit/runtime-client-gql";
import type { CopilotRuntimeClient } from "@copilotkit/runtime-client-gql";

export const agentStateKeys = {
  all: ["agentState"] as const,
  byThreadAgent: (threadId: string, agentName: string) =>
    ["agentState", threadId, agentName] as const,
};

export function useAgentStateQuery(params: {
  threadId?: string | null;
  agentName?: string | null;
  runtimeClient: CopilotRuntimeClient;
}) {
  const { threadId, agentName, runtimeClient } = params;
  const enabled = Boolean(threadId && agentName);

  return useQuery<Message[]>({
    queryKey: enabled
      ? (agentStateKeys.byThreadAgent(threadId!, agentName!) as QueryKey)
      : (agentStateKeys.all as QueryKey),
    enabled,
    queryFn: async () => {
      const result = await runtimeClient.loadAgentState({
        threadId: threadId!,
        agentName: agentName!,
      });
      if (result.error) throw result.error;
      const graphMessages = result.data?.loadAgentState?.messages;
      return loadMessagesFromJsonRepresentation(JSON.parse(graphMessages ?? "[]"));
    },
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
  });
}
