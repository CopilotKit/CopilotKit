import { CopilotChat } from "@copilotkit/react-ui";
import { Header } from "@/components/chat/Header";
import { CustomUserMessage } from "@/components/chat/UserMessage";
import { CustomAssistantMessage } from "@/components/chat/AssistantMessage";
import { CustomResponseButton } from "./chat/ResponseButton";
import ContactInfo from "./generative-ui/ContactInfo";
import { useCopilotAction } from "@copilotkit/react-core";

export function Chat({className}: {className?: string}) {

  useCopilotAction({
    name: "contactInfo",
    description: "Collect contact information from the user",
    renderAndWaitForResponse: ({respond, status}) => {
      if (status === "complete") return <></>;
      return <ContactInfo onSubmit={(form) => respond?.(form)} />;
    },
  });

  return (
    <div>
        <Header />
        <CopilotChat
            className={`rounded-xl border border-t-0 rounded-t-none shadow-xl ${className}`}
            UserMessage={CustomUserMessage}
            AssistantMessage={CustomAssistantMessage}
            ResponseButton={CustomResponseButton}
            labels={{
              initial: "Hi! I'm a fully customized CopilotKit assistant. How can I help you today? \n\nTry asking me to collect your contact information."
            }}
        />
    </div>
  );
}