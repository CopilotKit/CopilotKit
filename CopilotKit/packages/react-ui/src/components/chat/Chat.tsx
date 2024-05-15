import React, { useEffect, useRef, useState } from "react";
import { CopilotChatIcons, ChatContextProvider, CopilotChatLabels } from "./ChatContext";
import {
  SystemMessageFunction,
  extract,
  useCopilotChat,
  useCopilotContext,
} from "@copilotkit/react-core";
import {
  ButtonProps,
  HeaderProps,
  WindowProps,
  MessagesProps,
  InputProps,
  ResponseButtonProps,
  SuggestionsProps,
} from "./props";
import { Window as DefaultWindow } from "./Window";
import { Button as DefaultButton } from "./Button";
import { Header as DefaultHeader } from "./Header";
import { Messages as DefaultMessages } from "./Messages";
import { Input as DefaultInput } from "./Input";
import { nanoid } from "nanoid";
import { ResponseButton as DefaultResponseButton } from "./Response";
import { Suggestion, reloadSuggestions } from "./Suggestion";
import { CopilotChatSuggestion, CopilotChatSuggestionConfiguration } from "../../types/suggestions";
import { requestMicAndPlaybackPermission } from "./audio";
import { Message } from "@copilotkit/shared";

/**
 * Props for CopilotChat component.
 */
export interface CopilotChatProps {
  /**
   * Custom instructions to be added to the system message. Use this property to
   * provide additional context or guidance to the language model, influencing
   * its responses. These instructions can include specific directions,
   * preferences, or criteria that the model should consider when generating
   * its output, thereby tailoring the conversation more precisely to the
   * user's needs or the application's requirements.
   */
  instructions?: string;

  /**
   * Whether the chat window should be open by default.
   * @default false
   */
  defaultOpen?: boolean;

  /**
   * If the chat window should close when the user clicks outside of it.
   * @default true
   */
  clickOutsideToClose?: boolean;

  /**
   * If the chat window should close when the user hits the Escape key.
   * @default true
   */
  hitEscapeToClose?: boolean;

  /**
   * A callback that gets called when the chat window opens or closes.
   */
  onSetOpen?: (open: boolean) => void;

  /**
   * A callback that gets called when the in progress state changes.
   */
  onInProgress?: (inProgress: boolean) => void;

  /**
   * A callback that gets called when a new message it submitted.
   */
  onSubmitMessage?: (message: string) => void;

  /**
   * The shortcut key to open the chat window.
   * Uses Command-[shortcut] on a Mac and Ctrl-[shortcut] on Windows.
   * @default "/"
   */
  shortcut?: string;

  /**
   * Icons can be used to set custom icons for the chat window.
   */
  icons?: CopilotChatIcons;

  /**
   * Labels can be used to set custom labels for the chat window.
   */
  labels?: CopilotChatLabels;

  /**
   * A function that takes in context string and instructions and returns
   * the system message to include in the chat request.
   * Use this to completely override the system message, when providing
   * instructions is not enough.
   */
  makeSystemMessage?: SystemMessageFunction;

  /**
   * Whether to show the response button.
   * @default true
   */
  showResponseButton?: boolean;

  /**
   * A custom Window component to use instead of the default.
   */
  Window?: React.ComponentType<WindowProps>;

  /**
   * A custom Button component to use instead of the default.
   */
  Button?: React.ComponentType<ButtonProps>;

  /**
   * A custom Header component to use instead of the default.
   */
  Header?: React.ComponentType<HeaderProps>;

  /**
   * A custom Messages component to use instead of the default.
   */
  Messages?: React.ComponentType<MessagesProps>;

  /**
   * A custom Input component to use instead of the default.
   */
  Input?: React.ComponentType<InputProps>;

  /**
   * A custom ResponseButton component to use instead of the default.
   */
  ResponseButton?: React.ComponentType<ResponseButtonProps>;

  /**
   * A class name to apply to the root element.
   */
  className?: string;

  /**
   * Children to render.
   */
  children?: React.ReactNode;
}

const SUGGESTIONS_DEBOUNCE_TIMEOUT = 1000;

export const CopilotChat = ({
  instructions,
  defaultOpen = false,
  clickOutsideToClose = true,
  hitEscapeToClose = true,
  onSetOpen,
  onSubmitMessage,
  shortcut = "/",
  icons,
  labels,
  makeSystemMessage,
  showResponseButton = true,
  onInProgress,
  Window = DefaultWindow,
  Button = DefaultButton,
  Header = DefaultHeader,
  Messages = DefaultMessages,
  Input = DefaultInput,
  ResponseButton = DefaultResponseButton,
  className,
  children,
}: CopilotChatProps) => {
  const { visibleMessages, append, reload, stop, isLoading, input, setInput } = useCopilotChat({
    id: nanoid(),
    makeSystemMessage,
    additionalInstructions: instructions,
  });

  const [currentSuggestions, setCurrentSuggestions] = React.useState<CopilotChatSuggestion[]>([]);
  const suggestionsAbortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<any>();

  const abortSuggestions = () => {
    suggestionsAbortControllerRef.current?.abort();
    suggestionsAbortControllerRef.current = null;
  };

  const context = useCopilotContext();

  const [chatSuggestionConfiguration, setChatSuggestionConfiguration] = useState<{
    [key: string]: CopilotChatSuggestionConfiguration;
  }>({});

  const addChatSuggestionConfiguration = (
    id: string,
    suggestion: CopilotChatSuggestionConfiguration,
  ) => {
    setChatSuggestionConfiguration((prev) => ({ ...prev, [id]: suggestion }));
  };

  const removeChatSuggestion = (id: string) => {
    setChatSuggestionConfiguration((prev) => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
  };

  useEffect(() => {
    onInProgress?.(isLoading);

    abortSuggestions();

    debounceTimerRef.current = setTimeout(
      () => {
        if (!isLoading && Object.keys(chatSuggestionConfiguration).length !== 0) {
          suggestionsAbortControllerRef.current = new AbortController();
          reloadSuggestions(
            context,
            chatSuggestionConfiguration,
            setCurrentSuggestions,
            suggestionsAbortControllerRef,
          );
        }
      },
      currentSuggestions.length == 0 ? 0 : SUGGESTIONS_DEBOUNCE_TIMEOUT,
    );

    return () => {
      clearTimeout(debounceTimerRef.current);
    };
  }, [isLoading, chatSuggestionConfiguration]);

  const setOpen = (open: boolean) => {
    onSetOpen?.(open);
    setOpenState(open);
  };

  const sendMessage = async (messageContent: string) => {
    abortSuggestions();
    setCurrentSuggestions([]);
    onSubmitMessage?.(messageContent);
    const message: Message = {
      id: nanoid(),
      content: messageContent,
      role: "user",
    };
    append(message);
    return message;
  };

  const [openState, setOpenState] = React.useState(defaultOpen);
  const [pushToTalkState, setPushToTalkState] = React.useState(false);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [lastMessageIdBeforeAudio, setLastMessageIdBeforeAudio] = useState<string | null>(null);

  useEffect(() => {
    if (pushToTalkState) {
      console.log("HERE");
      if (!mediaStreamRef.current || !audioContextRef.current) {
        setPushToTalkState(false);
        requestMicAndPlaybackPermission().then((res) => {
          if (res) {
            mediaStreamRef.current = res.stream;
            audioContextRef.current = res.audioContext;
          }
        });
      } else {
        console.log("Recording started");
        const recordedChunks: Blob[] = [];

        mediaRecorderRef.current = new MediaRecorder(mediaStreamRef.current);
        mediaRecorderRef.current.start(1000);
        mediaRecorderRef.current.ondataavailable = async (event) => {
          console.log("Recorded audio: ", event.data);
          recordedChunks.push(event.data);
        };
        mediaRecorderRef.current.onstop = async () => {
          console.log("Recording stopped");
          const completeBlob = new Blob(recordedChunks, { type: "audio/mp4" });

          const formData = new FormData();
          formData.append("file", completeBlob, "recording.mp4");

          const response = await fetch(context.copilotApiConfig.transcribeAudioUrl!, {
            method: "POST",
            body: formData,
          });

          if (!response.ok) {
            throw new Error(`Error: ${response.statusText}`);
          }

          const transcription = await response.json();
          const message = await sendMessage(transcription.text);
          setLastMessageIdBeforeAudio(message.id);
        };
      }
    } else {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    }

    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    };
  }, [pushToTalkState]);

  useEffect(() => {
    if (lastMessageIdBeforeAudio && !isLoading) {
      if (audioContextRef.current) {
        const lastMessageIndex = context.messages.findIndex(
          (message) => message.id === lastMessageIdBeforeAudio,
        );

        const messagesAfterLast = context.messages
          .slice(lastMessageIndex + 1)
          .filter((message) => message.role === "assistant" && message.content);

        const text = messagesAfterLast.map((message) => message.content).join("\n");
        const encodedText = encodeURIComponent(text);
        const url = `${context.copilotApiConfig.textToSpeechUrl}?text=${encodedText}`;

        fetch(url)
          .then((response) => response.arrayBuffer())
          .then((arrayBuffer) => audioContextRef.current!.decodeAudioData(arrayBuffer))
          .then((audioBuffer) => {
            const source = audioContextRef.current!.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContextRef.current!.destination);
            source.start(0);
          })
          .catch((error) => {
            console.error("Error with decoding audio data", error);
          });

        setLastMessageIdBeforeAudio(null);
      }
    }
  }, [isLoading]);

  return (
    <ChatContextProvider
      icons={icons}
      labels={labels}
      open={openState}
      setOpen={setOpenState}
      addChatSuggestionConfiguration={addChatSuggestionConfiguration}
      removeChatSuggestionConfiguration={removeChatSuggestion}
    >
      {children}
      <div className={className}>
        <Button
          open={openState}
          setOpen={setOpen}
          pushToTalk={pushToTalkState}
          setPushToTalk={setPushToTalkState}
        ></Button>
        <Window
          open={openState}
          setOpen={setOpen}
          clickOutsideToClose={clickOutsideToClose}
          shortcut={shortcut}
          hitEscapeToClose={hitEscapeToClose}
        >
          <Header open={openState} setOpen={setOpen} />
          <Messages messages={visibleMessages} inProgress={isLoading}>
            {currentSuggestions.length > 0 && (
              <div>
                <h6>Suggested:</h6>
                <div className="suggestions">
                  {currentSuggestions.map((suggestion, index) => (
                    <Suggestion
                      key={index}
                      title={suggestion.title}
                      message={suggestion.message}
                      partial={suggestion.partial}
                      className={suggestion.className}
                      onClick={(message) => sendMessage(message)}
                    />
                  ))}
                </div>
              </div>
            )}
            {showResponseButton && visibleMessages.length > 0 && (
              <ResponseButton onClick={isLoading ? stop : reload} inProgress={isLoading} />
            )}
          </Messages>
          <Input inProgress={isLoading} onSend={sendMessage} isVisible={openState} />
        </Window>
      </div>
    </ChatContextProvider>
  );
};
