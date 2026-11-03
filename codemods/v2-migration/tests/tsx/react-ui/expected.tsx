// TODO(copilotkit-2.0): `CopilotChat`: Its props changed in 2.0. Check each prop against the docs. https://docs.copilotkit.ai/reference/v2/components/CopilotChat
// TODO(copilotkit-2.0): `CopilotPopup`: Its props changed in 2.0. Check each prop against the docs. https://docs.copilotkit.ai/reference/v2/components/CopilotPopup
// TODO(copilotkit-2.0): `useCopilotChatSuggestions` was removed in 2.0. Use `useConfigureSuggestions` from "@copilotkit/react-core" instead. Its API is different: https://docs.copilotkit.ai/reference/v2/hooks/useConfigureSuggestions
// TODO(copilotkit-2.0): `useCopilotChatSuggestions`: This replacement moves from react-ui to react-core.
// TODO(copilotkit-2.0): `Markdown` was removed in 2.0 and has no direct replacement. See https://docs.copilotkit.ai/prebuilt-components/chat
import { CopilotChat, CopilotPopup } from "@copilotkit/react-core";
import { useCopilotChatSuggestions, Markdown } from "@copilotkit/react-ui";

export function Chat() {
  useCopilotChatSuggestions({ instructions: "Suggest next steps" });
  return <CopilotChat labels={{ title: "Assistant" }} />;
}
