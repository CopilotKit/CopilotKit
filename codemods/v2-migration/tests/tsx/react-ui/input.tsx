import { CopilotChat, CopilotPopup, useCopilotChatSuggestions, Markdown } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";

export function Chat() {
  useCopilotChatSuggestions({ instructions: "Suggest next steps" });
  return <CopilotChat labels={{ title: "Assistant" }} />;
}
