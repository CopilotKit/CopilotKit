import React, { useMemo, useState } from "react";
import * as DefaultIcons from "./Icons";
import { ThumbsDownIcon, ThumbsUpIcon } from "./Icons";

/**
 * Icons for CopilotChat component.
 */
export interface CopilotChatIcons {
  /**
   * The icon to use for the open chat button.
   * @default <OpenIcon />
   */
  openIcon?: React.ReactNode;

  /**
   * The icon to use for the close chat button.
   * @default <CloseIcon />
   */
  closeIcon?: React.ReactNode;

  /**
   * The icon to use for the close chat button in the header.
   * @default <HeaderCloseIcon />
   */
  headerCloseIcon?: React.ReactNode;

  /**
   * The icon to use for the send button.
   * @default <SendIcon />
   */
  sendIcon?: React.ReactNode;

  /**
   * The icon to use for the activity indicator.
   * @default <ActivityIcon />
   */
  activityIcon?: React.ReactNode;

  /**
   * The icon to use for the spinner.
   * @default <SpinnerIcon />
   */
  spinnerIcon?: React.ReactNode;

  /**
   * The icon to use for the stop button.
   * @default <StopIcon />
   */
  stopIcon?: React.ReactNode;

  /**
   * The icon to use for the regenerate button.
   * @default <RegenerateIcon />
   */
  regenerateIcon?: React.ReactNode;

  /**
   * The icons to use for push to talk.
   * @default <PushToTalkIcon />
   */

  pushToTalkIcon?: React.ReactNode;

  /**
   * The icons to use for copy assistant response
   * @default <CopyIcon />
   */

  copyIcon?: React.ReactNode;

  /**
   * The icon to use for thumbs up/response approval.
   * @default <ThumbsUpIcon />
   */

  thumbsUpIcon?: React.ReactNode;

  /**
   * The icon to use for thumbs down/response rejection.
   * @default <ThumbsDownIcon />
   */

  thumbsDownIcon?: React.ReactNode;

  /**
   * The icon to use for the upload button.
   * @default <UploadIcon />
   */
  uploadIcon?: React.ReactNode;
}

/**
 * Labels for CopilotChat component.
 */
export interface CopilotChatLabels {
  /**
   * The initial message(s) to display in the chat window.
   */
  initial?: string | string[];

  /**
   * The title to display in the header.
   * @default "CopilotKit"
   */
  title?: string;

  /**
   * The placeholder to display in the input.
   * @default "Type a message..."
   */
  placeholder?: string;

  /**
   * The message to display when an error occurs.
   * @default "❌ An error occurred. Please try again."
   */
  error?: string;

  /**
   * The label to display on the stop button.
   * @default "Stop generating"
   */
  stopGenerating?: string;

  /**
   * The label to display on the regenerate button.
   * @default "Regenerate response"
   */
  regenerateResponse?: string;

  /**
   * The label for the copy button.
   * @default "Copy to clipboard"
   */
  copyToClipboard?: string;

  /**
   * The label for the thumbs up button.
   * @default "Thumbs up"
   */
  thumbsUp?: string;

  /**
   * The label for the thumbs down button.
   * @default "Thumbs down"
   */
  thumbsDown?: string;

  /**
   * The text to display when content is copied.
   * @default "Copied!"
   */
  copied?: string;
}

interface ChatContext {
  labels: Required<CopilotChatLabels>;
  icons: Required<CopilotChatIcons>;
  open: boolean;
  setOpen: (open: boolean) => void;
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
  labels?: CopilotChatLabels;
  icons?: CopilotChatIcons;
  children?: React.ReactNode;
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const ChatContextProvider = ({
  // temperature,
  // instructions,
  // maxFeedback,
  labels,
  icons,
  children,
  open,
  setOpen,
}: ChatContextProps) => {
  const memoizedLabels = useMemo(
    () => ({
      ...{
        initial: "",
        title: "CopilotKit",
        placeholder: "Type a message...",
        error: "❌ An error occurred. Please try again.",
        stopGenerating: "Stop generating",
        regenerateResponse: "Regenerate response",
        copyToClipboard: "Copy to clipboard",
        thumbsUp: "Thumbs up",
        thumbsDown: "Thumbs down",
        copied: "Copied!",
      },
      ...labels,
    }),
    [labels],
  );

  const memoizedIcons = useMemo(
    () => ({
      ...{
        openIcon: DefaultIcons.OpenIcon,
        closeIcon: DefaultIcons.CloseIcon,
        headerCloseIcon: DefaultIcons.HeaderCloseIcon,
        sendIcon: DefaultIcons.SendIcon,
        activityIcon: DefaultIcons.ActivityIcon,
        spinnerIcon: DefaultIcons.SpinnerIcon,
        stopIcon: DefaultIcons.StopIcon,
        regenerateIcon: DefaultIcons.RegenerateIcon,
        pushToTalkIcon: DefaultIcons.MicrophoneIcon,
        copyIcon: DefaultIcons.CopyIcon,
        thumbsUpIcon: DefaultIcons.ThumbsUpIcon,
        thumbsDownIcon: DefaultIcons.ThumbsDownIcon,
        uploadIcon: DefaultIcons.UploadIcon,
      },
      ...icons,
    }),
    [icons],
  );

  const context = useMemo(
    () => ({
      labels: memoizedLabels,
      icons: memoizedIcons,
      open,
      setOpen,
    }),
    [memoizedLabels, memoizedIcons, open, setOpen],
  );

  return <ChatContext.Provider value={context}>{children}</ChatContext.Provider>;
};
