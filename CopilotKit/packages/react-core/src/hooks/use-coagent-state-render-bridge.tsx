import { ReactCustomMessageRendererPosition, useAgent } from "@copilotkitnext/react";
import { useEffect, useMemo, useState } from "react";
import type { AgentSubscriber } from "@ag-ui/client";
import { useCoAgentStateRenders } from "../context";
import { parseJson } from "@copilotkit/shared";

export function useCoagentStateRenderBridge(
  agentId: string,
  props: {
    message: any;
    position: ReactCustomMessageRendererPosition;
    runId: string;
    messageIndex: number;
    messageIndexInRun: number;
    numberOfMessagesInRun: number;
    agentId: string;
    stateSnapshot: any;
  },
) {
  const { messageIndexInRun, stateSnapshot } = props;
  const { coAgentStateRenders } = useCoAgentStateRenders();
  const { agent } = useAgent({ agentId });
  const [nodeName, setNodeName] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!agent) return;
    const subscriber: AgentSubscriber = {
      onStepStartedEvent: ({ event }) => {
        if (event.stepName !== nodeName) {
          setNodeName(event.stepName);
        }
      },
      onStepFinishedEvent: ({ event }) => {
        if (event.stepName === nodeName) {
          setNodeName(undefined);
        }
      },
    };

    const { unsubscribe } = agent.subscribe(subscriber);
    return () => {
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, nodeName]);

  if (messageIndexInRun !== 0) {
    return null;
  }

  const foundRender = useMemo(() => {
    return Object.entries(coAgentStateRenders).find(([_, stateRender]) => {
      const matchingAgentName = stateRender.name === agentId;
      const matchingNodeName = stateRender.nodeName === nodeName;
      return matchingAgentName && (nodeName ? matchingNodeName : true);
    });
  }, [coAgentStateRenders, nodeName, agentId]);

  return useMemo(() => {
    const [, stateRender] = foundRender ?? [];

    if (!stateRender || messageIndexInRun !== 0) return null;

    if (stateRender.handler) {
      stateRender.handler({
        state: stateSnapshot ? parseJson(stateSnapshot, stateSnapshot) : (agent?.state ?? {}),
        nodeName: nodeName ?? "",
      });
    }

    if (stateRender.render) {
      const status = agent?.isRunning ? "inProgress" : "complete";

      if (typeof stateRender.render === "string") return stateRender.render;
      return stateRender.render({
        status,
        state: stateSnapshot ? parseJson(stateSnapshot, stateSnapshot) : (agent?.state ?? {}),
        nodeName: nodeName ?? "",
      });
    }
  }, [foundRender, stateSnapshot, agent?.state, agent?.isRunning, nodeName]);
}

export function CoAgentStateRenderBridge(props: {
  message: any;
  position: ReactCustomMessageRendererPosition;
  runId: string;
  messageIndex: number;
  messageIndexInRun: number;
  numberOfMessagesInRun: number;
  agentId: string;
  stateSnapshot: any;
}) {
  return useCoagentStateRenderBridge(props.agentId, props);
}
