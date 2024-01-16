import React, { useMemo } from "react";
import * as DefaultIcons from "./Icons";

export type CopilotKitColorScheme = "auto" | "light" | "dark";

export interface CopilotKitIcons {
  openIcon?: React.ReactNode;
  closeIcon?: React.ReactNode;
  headerCloseIcon?: React.ReactNode;
  sendIcon?: React.ReactNode;
  activityIcon?: React.ReactNode;
  spinnerIcon?: React.ReactNode;
}

interface CopilotKitLabels {
  initial?: string | string[];
  title?: string;
  placeholder?: string;
  thinking?: string;
  done?: string;
  error?: string;
}

interface TemporaryContext {
  labels: Required<CopilotKitLabels>;
  icons: Required<CopilotKitIcons>;
  colorScheme: CopilotKitColorScheme;
}

export const TemporaryContext = React.createContext<TemporaryContext | undefined>(undefined);

export function useTemporaryContext(): TemporaryContext {
  const context = React.useContext(TemporaryContext);
  if (context === undefined) {
    throw new Error(
      "Context not found. Did you forget to wrap your app in a <Temporary> component?",
    );
  }
  return context;
}

interface CopilotKitProps {
  temperature?: number;
  instructions?: string;
  // maxFeedback?: number;
  labels?: CopilotKitLabels;
  children?: React.ReactNode;
}

export const Temporary: React.FC<CopilotKitProps> = ({
  temperature,
  instructions,
  // maxFeedback,
  labels,
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

      colorScheme: "auto" as CopilotKitColorScheme,
      icons: {
        openIcon: DefaultIcons.OpenIcon,
        closeIcon: DefaultIcons.CloseIcon,
        headerCloseIcon: DefaultIcons.HeaderCloseIcon,
        sendIcon: DefaultIcons.SendIcon,
        activityIcon: DefaultIcons.ActivityIcon,
        spinnerIcon: DefaultIcons.SpinnerIcon,
      },
    }),
    [labels],
  );
  return <TemporaryContext.Provider value={context}>{children}</TemporaryContext.Provider>;
};
