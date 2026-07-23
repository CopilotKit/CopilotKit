"use client";

import * as React from "react";
import {
  UseAgentUpdate,
  useAgent,
  useCopilotKit,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import {
  ArrowUpIcon,
  MessageCircleDashedIcon,
  PaperclipIcon,
  PlusIcon,
  RotateCwIcon,
} from "lucide-react";
import {
  MessageAnimated,
  MessageAnimatedLoading,
  MessageAnimatedMessagesProvider,
} from "@/components/message-animated";
import {
  LineChartCard,
  LineChartCardSkeleton,
  lineChartSchema,
} from "@/components/generative-ui/line-chart";
import { MakeItRain } from "@/components/generative-ui/make-it-rain";
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group";
import { Marker, MarkerContent } from "@/components/ui/marker";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type AgentMessage = {
  id?: string;
  role?: string;
  content?: unknown;
  toolCallId?: string;
  toolCalls?: AgentToolCall[];
};

type AgentToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

const queuedMessages = [
  "Explain to me briefly what ShadCN is and how I can use it.",
  "Render one simple line chart.",
  "Show a small human-in-the-loop taco rain picker.",
];

const BASE_CHAT_WIDTH = 384;
const BASE_CARD_HEIGHT = 560;
const BASE_CHAT_STACK_HEIGHT = 608;
const VIEWPORT_MARGIN = 32;

function messageText(content: unknown) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (
          part &&
          typeof part === "object" &&
          "text" in part &&
          typeof part.text === "string"
        ) {
          return part.text;
        }

        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  return content ? JSON.stringify(content, null, 2) : "";
}

function messageRole(message: AgentMessage): "user" | "assistant" | "system" {
  if (message.role === "user") {
    return "user";
  }

  if (message.role === "system") {
    return "system";
  }

  return "assistant";
}

function hasToolCalls(message: AgentMessage) {
  return Array.isArray(message.toolCalls) && message.toolCalls.length > 0;
}

function isVisibleMessage(message: AgentMessage) {
  if (message.role === "tool") {
    return false;
  }

  return (
    messageText(message.content).trim().length > 0 || hasToolCalls(message)
  );
}

function isWaitingForAssistant(messages: AgentMessage[]) {
  const lastVisibleMessage = messages.at(-1);

  return Boolean(
    lastVisibleMessage && messageRole(lastVisibleMessage) === "user",
  );
}

function calculateChatScale() {
  if (typeof window === "undefined") {
    return 1;
  }

  const targetHalfViewport = (window.innerHeight * 0.5) / BASE_CARD_HEIGHT;
  const fitWidth = (window.innerWidth - VIEWPORT_MARGIN) / BASE_CHAT_WIDTH;
  const fitHeight =
    (window.innerHeight - VIEWPORT_MARGIN) / BASE_CHAT_STACK_HEIGHT;

  return Math.max(
    0.72,
    Math.min(Math.max(1, targetHalfViewport), fitWidth, fitHeight),
  );
}

function useResponsiveChatScale() {
  const [scale, setScale] = React.useState(1);

  React.useEffect(() => {
    function updateScale() {
      setScale(calculateChatScale());
    }

    updateScale();
    window.addEventListener("resize", updateScale);
    window.visualViewport?.addEventListener("resize", updateScale);

    return () => {
      window.removeEventListener("resize", updateScale);
      window.visualViewport?.removeEventListener("resize", updateScale);
    };
  }, []);

  return scale;
}

export function SimpleChat() {
  return <ChatPanel />;
}

function ChatPanel() {
  const [error, setError] = React.useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = React.useState<File | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const chatScale = useResponsiveChatScale();
  const { copilotkit } = useCopilotKit();
  const { agent } = useAgent({
    agentId: "default",
    updates: [
      UseAgentUpdate.OnMessagesChanged,
      UseAgentUpdate.OnRunStatusChanged,
    ],
    throttleMs: 50,
  });

  useFrontendTool(
    {
      name: "renderLineChart",
      agentId: "default",
      parameters: lineChartSchema,
      handler: async () => "Line chart rendered.",
      render: ({ args, status }) =>
        status === "complete" ? (
          <LineChartCard {...args} />
        ) : (
          <LineChartCardSkeleton />
        ),
      followUp: false,
      description:
        "Render exactly one compact line chart. Use 2 to 12 ordered finite numeric points and short labels.",
    },
    [],
  );

  const messages = (agent.messages ?? []) as AgentMessage[];
  const visibleMessages = messages.filter(isVisibleMessage);
  const isRunning = Boolean(agent.isRunning);
  const showAssistantLoading =
    isRunning && isWaitingForAssistant(visibleMessages);
  const nextMessage =
    queuedMessages[
      messages.filter((message) => messageRole(message) === "user").length
    ] ?? null;

  async function sendMessage() {
    if (!nextMessage || isRunning) {
      return;
    }

    setError(null);

    try {
      agent.addMessage({
        id: crypto.randomUUID(),
        role: "user",
        content: nextMessage,
      } as never);
      await copilotkit.runAgent({ agent });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "The assistant could not be reached.",
      );
    }
  }

  function resetConversation() {
    if (isRunning) {
      agent.abortRun();
    }

    agent.setMessages([]);
    setUploadedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setError(null);
  }

  function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    setUploadedFile(event.currentTarget.files?.[0] ?? null);
  }

  return (
    <MessageScrollerProvider>
      <MakeItRain />
      <main className="flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
        <div
          className="relative"
          style={{
            height: BASE_CHAT_STACK_HEIGHT * chatScale,
            width: BASE_CHAT_WIDTH * chatScale,
          }}
        >
          <div
            className="relative flex origin-top-left flex-col gap-4"
            style={{
              transform: `scale(${chatScale})`,
              width: BASE_CHAT_WIDTH,
            }}
          >
            <Card className="mx-auto h-140 w-full max-w-sm gap-0">
              <CardHeader className="gap-1 border-b">
                <CardTitle>New Chat</CardTitle>
                <CardDescription>How can I help you today?</CardDescription>
                <CardAction>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="Reset conversation"
                        onClick={resetConversation}
                      >
                        <RotateCwIcon />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Reset</p>
                    </TooltipContent>
                  </Tooltip>
                </CardAction>
              </CardHeader>

              <CardContent className="flex-1 overflow-hidden p-0">
                {visibleMessages.length === 0 ? (
                  <Empty className="h-full">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <MessageCircleDashedIcon />
                      </EmptyMedia>
                      <EmptyTitle>Ready when you are</EmptyTitle>
                      <EmptyDescription>
                        Press send to run the first example.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  <MessageScroller>
                    <MessageScrollerViewport>
                      <MessageScrollerContent
                        aria-busy={isRunning}
                        className="p-(--card-spacing)"
                      >
                        <MessageAnimatedMessagesProvider messages={messages}>
                          {visibleMessages.map((message, index) => (
                            <MessageAnimated
                              key={message.id ?? `${message.role}-${index}`}
                              message={message}
                              scrollAnchor={messageRole(message) === "user"}
                            />
                          ))}
                          {showAssistantLoading ? (
                            <MessageAnimatedLoading />
                          ) : null}
                        </MessageAnimatedMessagesProvider>
                      </MessageScrollerContent>
                    </MessageScrollerViewport>
                    <MessageScrollerButton />
                  </MessageScroller>
                )}
              </CardContent>

              <CardFooter className="flex-col gap-2">
                {uploadedFile ? (
                  <Attachment size="sm" className="w-full">
                    <AttachmentMedia>
                      <PaperclipIcon />
                    </AttachmentMedia>
                    <AttachmentContent>
                      <AttachmentTitle>{uploadedFile.name}</AttachmentTitle>
                      <AttachmentDescription>
                        {formatFileSize(uploadedFile.size)}
                      </AttachmentDescription>
                    </AttachmentContent>
                  </Attachment>
                ) : null}
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void sendMessage();
                  }}
                  className="w-full"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="sr-only"
                    onChange={handleFileUpload}
                  />
                  <InputGroup>
                    <div className="h-14 w-full px-3 py-2.5">
                      <span
                        className="line-clamp-2 opacity-60 data-[status=ready]:opacity-100"
                        data-status={
                          nextMessage && !isRunning ? "ready" : "busy"
                        }
                      >
                        {nextMessage ? (
                          nextMessage
                        ) : (
                          <span className="text-muted-foreground">
                            All examples complete. Reset to replay.
                          </span>
                        )}
                      </span>
                    </div>
                    <InputGroupAddon align="block-end" className="pt-1">
                      <InputGroupButton
                        aria-label="Upload file"
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <PlusIcon />
                      </InputGroupButton>
                      <InputGroupButton
                        type="submit"
                        variant="default"
                        size="icon-sm"
                        disabled={!nextMessage || isRunning}
                        className="ml-auto"
                      >
                        <ArrowUpIcon />
                        <span className="sr-only">Send</span>
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                </form>

                {error ? (
                  <Marker className="min-h-0 text-xs text-destructive">
                    <MarkerContent>{error}</MarkerContent>
                  </Marker>
                ) : null}
              </CardFooter>
            </Card>
            <div className="px-0.5 text-center text-xs text-muted-foreground">
              {nextMessage
                ? "Press send to run the next example."
                : "Reset to replay the examples."}
            </div>
          </div>
        </div>
      </main>
    </MessageScrollerProvider>
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"] as const;
  let size = bytes / 1024;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}
