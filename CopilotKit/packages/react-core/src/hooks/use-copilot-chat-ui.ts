import { useCopilotContext } from "../context";
import { useEffect } from "react";

export interface UseCopilotChatUIRenderProps<S = any> {
  state: S;
  nodeName: string;
  agentName: string;
}

export interface CopilotChatUI<S = any> {
  agentName: string;
  nodeName?: string;
  render: string | ((props: UseCopilotChatUIRenderProps<S>) => string | React.ReactElement);
}

export function useCopilotChatUI<S = any>(chatUI: CopilotChatUI<S>) {
  const { chatUI: chatUIFromContext, setChatUI } = useCopilotContext();

  useEffect(() => {
    setChatUI([...chatUIFromContext, chatUI]);

    return () => {
      setChatUI(chatUIFromContext.filter((ui) => ui !== chatUI));
    };
  }, [chatUI, chatUIFromContext, setChatUI]);
}
