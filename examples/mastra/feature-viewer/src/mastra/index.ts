import { Mastra } from "@mastra/core/mastra";
import {
  agenticChatAgent,
  humanInTheLoopAgent,
  toolBasedGenerativeUiAgent,
} from "./agents";

export const mastra = new Mastra({
  agents: {
    agenticChatAgent,
    humanInTheLoopAgent,
    toolBasedGenerativeUiAgent,
  },
});
