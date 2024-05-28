import { useCopilotChat } from "./use-copilot-chat";

export function useCopilotAddMessage() {
  const { append } = useCopilotChat({});

  return append;
}
