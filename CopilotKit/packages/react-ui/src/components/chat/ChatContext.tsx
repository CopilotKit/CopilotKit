import React, { useMemo } from "react";
import * as DefaultIcons from "./Icons";

export interface CopilotKitChatIcons {
  openIcon?: React.ReactNode;
  closeIcon?: React.ReactNode;
  headerCloseIcon?: React.ReactNode;
  sendIcon?: React.ReactNode;
  activityIcon?: React.ReactNode;
  spinnerIcon?: React.ReactNode;
}

export interface CopilotKitChatLabels {
  initial?: string | string[];
  title?: string;
  placeholder?: string;
  thinking?: string;
  done?: string;
  error?: string;
}

interface ChatContext {
  labels: Required<CopilotKitChatLabels>;
  icons: Required<CopilotKitChatIcons>;
}

export const ChatContext = React.createContext<ChatContext | undefined>(undefined);

export function useChatContext(): ChatContext {
  const context = React.useContext(ChatContext);
  if (context === undefined) {
    throw new Error(
      "Context not found. Did you forget to wrap your app in a <ChatContextProvider> component?",
    );
  }
  return context;
}

interface ChatContextProps {
  // temperature?: number;
  // instructions?: string;
  // maxFeedback?: number;
  labels?: CopilotKitChatLabels;
  icons?: CopilotKitChatIcons;
  children?: React.ReactNode;
}

export const ChatContextProvider: React.FC<ChatContextProps> = ({
  // temperature,
  // instructions,
  // maxFeedback,
  labels,
  icons,
  children,
}) => {
  const context = useMemo(
    () => ({
      labels: {
        ...{
          initial: "",
          title: "Assistant",
          placeholder: "Type a message...",
          thinking: "Thinking...",
          done: "✅ Done",
          error: "❌ An error occurred. Please try again.",
        },
        ...labels,
      },

      icons: {
        ...{
          openIcon: DefaultIcons.OpenIcon,
          closeIcon: DefaultIcons.CloseIcon,
          headerCloseIcon: DefaultIcons.HeaderCloseIcon,
          sendIcon: DefaultIcons.SendIcon,
          activityIcon: DefaultIcons.ActivityIcon,
          spinnerIcon: DefaultIcons.SpinnerIcon,
        },
        icons,
      },
    }),
    [labels, icons],
  );
  return <ChatContext.Provider value={context}>{children}</ChatContext.Provider>;
};
