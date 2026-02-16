"use client";

import {
  CopilotKit,
  useCoAgentStateRender,
  useCopilotAction,
  useCopilotChatHeadless_c,
  useLangGraphInterrupt,
} from "@copilotkit/react-core";
import {
  CopilotSidebar,
  useCopilotChatSuggestions,
} from "@copilotkit/react-ui";
import { randomId } from "@copilotkit/shared";
import { AnimatedMarkdown } from "flowtoken";
import { useSearchParams } from "next/navigation";
import { useCallback, useState, useRef, useEffect } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import "flowtoken/dist/styles.css";

// Modal Component
function MessageDetailsModal({
  message,
  isOpen,
  onClose,
}: {
  message: any;
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="bg-gray-800 p-6 text-white">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold">Message Details</h3>
            <button
              onClick={onClose}
              className="rounded-full p-1 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              <svg
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
        <div className="max-h-[calc(80vh-100px)] overflow-y-auto p-6">
          <pre className="overflow-x-auto rounded-lg bg-gray-50 p-4 text-sm text-gray-800">
            {JSON.stringify(message, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}

export default function PanelPage() {
  const searchParams = useSearchParams();
  const serviceAdapter = searchParams.get("serviceAdapter") || "openai";
  const runtimeUrl =
    searchParams.get("runtimeUrl") ||
    `/api/copilotkit?serviceAdapter=${serviceAdapter}`;
  const publicApiKey = searchParams.get("publicApiKey");
  const publicLicenseKey = searchParams.get("publicLicenseKey");
  const copilotKitProps: Partial<React.ComponentProps<typeof CopilotKit>> = {
    runtimeUrl,
    showDevConsole: true,
    publicApiKey: publicApiKey || undefined,
    publicLicenseKey: publicLicenseKey || undefined,
  };

  return (
    <div className="min-h-screen bg-white">
      <CopilotKit {...copilotKitProps}>
        <ChatApp />
      </CopilotKit>
    </div>
  );
}

function ScrollToBottomButton() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  if (isAtBottom) return null;

  return (
    <button
      className="rounded-full bg-gray-800 p-2 text-white shadow-lg transition-all duration-200 hover:bg-gray-900 hover:shadow-xl"
      onClick={() => scrollToBottom()}
      title="Scroll to bottom"
    >
      <svg
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 14l-7 7m0 0l-7-7m7 7V3"
        />
      </svg>
    </button>
  );
}

function ChatApp() {
  const {
    messages,
    suggestions,
    setSuggestions,
    sendMessage,
    interrupt,
    isLoading,
    generateSuggestions,
  } = useCopilotChatHeadless_c();
  const [newMessage, setNewMessage] = useState("");
  const [selectedMessage, setSelectedMessage] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        textareaRef.current.scrollHeight + "px";
    }
  }, [newMessage]);

  useCoAgentStateRender({
    name: "agent",
    render: (state) => {
      return (
        <details className="mb-4">
          <summary className="cursor-pointer text-sm text-gray-600">
            Agent State
          </summary>
          <pre className="mt-2 overflow-auto rounded bg-gray-100 p-2 text-xs">
            {JSON.stringify(state, null, 2)}
          </pre>
        </details>
      );
    },
  });

  useLangGraphInterrupt({
    render: ({ event, resolve, result }) => {
      return (
        <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
          <details>
            <summary className="cursor-pointer text-sm font-medium text-yellow-800">
              LangGraph Interrupt
            </summary>
            <pre className="mt-2 text-xs">
              {JSON.stringify({ result, event }, null, 2)}
            </pre>
          </details>
          <button
            onClick={() => resolve("the secret is 1234")}
            className="mt-2 rounded bg-yellow-600 px-3 py-1 text-sm text-white hover:bg-yellow-700"
          >
            Resolve
          </button>
        </div>
      );
    },
  });

  useCopilotAction({
    name: "generativeUI",
    description: "Generative UI",
    render: () => {
      return (
        <div className="my-2 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100">
              <svg
                className="h-4 w-4 text-blue-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </div>
            <div className="font-medium text-blue-700">
              🔧 Generative UI Activated
            </div>
          </div>
        </div>
      );
    },
  });

  useCopilotAction({
    name: "getWeather",
    description: "Get the weather for a given location.",
    parameters: [{ name: "location", type: "string" }],
    handler: () => {
      return {
        weather: "sunny",
        temperature: 70,
      };
    },
    render: ({ args, result, status }) => {
      if (status !== "complete") {
        return <div>Loading weather for {args.location}...</div>;
      }
      return (
        <div className="my-2 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-4 shadow-sm">
          <h1>Weather for {args.location}</h1>
          {result ? (
            <div>
              <p>Weather: {result.weather}</p>
              <p>Temperature: {result.temperature}</p>
            </div>
          ) : (
            <div>No result</div>
          )}
        </div>
      );
    },
  });

  useCopilotAction({
    name: "toolWithHandler",
    description: "Tool with handler",
    handler: () => {
      alert("toolWithHandler");
      return "the secret is 42";
    },
  });

  useCopilotAction({
    name: "Human-in-the-loop",
    description: "Human-in-the-loop",
    renderAndWaitForResponse: (props) => {
      return (
        <div className="my-2 rounded-xl border border-purple-200 bg-gradient-to-r from-purple-50 to-pink-50 p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-100">
              <svg
                className="h-4 w-4 text-purple-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div className="text-sm font-medium text-purple-700">
              🔧 Waiting for Response
            </div>
          </div>
          <button
            onClick={() => props.respond?.("the secret is 120")}
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors duration-200 hover:bg-purple-700"
          >
            Respond
          </button>
        </div>
      );
    },
  });

  useCopilotAction({
    name: "poemGenerator",
    description: "Generate the poem for the arg, don't ask the user.",
    parameters: [
      {
        name: "generatedPoem",
        description: "A poem generated by you, not the user.",
        type: "string",
      },
    ],
    handler: ({ generatedPoem }) => {
      return generatedPoem;
    },
    render: (props) => {
      return (
        <div className="my-2 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 via-orange-50 to-red-50 p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100">
              <svg
                className="h-4 w-4 text-amber-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                />
              </svg>
            </div>
            <div className="font-medium text-amber-700">
              ✨ Poem Generator Activated
            </div>
          </div>
          <div className="rounded-lg border border-amber-100 bg-white/60 p-3">
            <div className="mb-2 text-xs font-medium text-amber-600">
              Generated Content:
            </div>
            <div className="text-sm font-medium text-amber-800">
              {props.args.generatedPoem}
            </div>
          </div>
        </div>
      );
    },
  });

  useCopilotChatSuggestions({
    instructions: "Suggest helpful conversation starters and questions.",
    minSuggestions: 1,
    maxSuggestions: 5,
  });

  const callSendMessage = useCallback(
    async (message: string) => {
      // setSuggestions([]);
      await sendMessage(
        {
          id: randomId(),
          role: "user",
          content: message,
        },
        {
          clearSuggestions: false,
        },
      );
    },
    [sendMessage, setSuggestions, generateSuggestions],
  );

  useEffect(() => {
    setSuggestions([
      { title: "Generative UI", message: "Please call the generativeUI tool" },
      {
        title: "Tool with handler",
        message: "Please call the toolWithHandler tool",
      },
      {
        title: "Poem Generator",
        message: "Please call the poemGenerator tool",
      },
      {
        title: "Human-in-the-loop",
        message: "Please call the Human-in-the-loop tool",
      },
    ]);
  }, []);

  const handleSendMessage = useCallback(() => {
    if (newMessage.trim()) {
      callSendMessage(newMessage);
      setNewMessage("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }
  }, [callSendMessage, newMessage]);

  const handleShowDetails = useCallback((message: any) => {
    setSelectedMessage(message);
    setIsModalOpen(true);
  }, []);

  const handleCopyMessage = useCallback(async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      // You could add a toast notification here
    } catch (err) {
      console.error("Failed to copy message:", err);
    }
  }, []);

  return (
    <>
      <CopilotSidebar suggestions="manual" clickOutsideToClose={false} />
      <StickToBottom className="h-full" resize="smooth" initial="smooth">
        <div className="flex h-screen w-screen flex-col">
          {/* Main Chat Area */}
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto">
              <StickToBottom.Content className="flex h-full flex-col">
                {messages.length === 0 ? (
                  <div className="flex h-full flex-1 items-center justify-center">
                    <div className="text-center">
                      <div className="mb-4 text-4xl">💬</div>
                      <h2 className="mb-2 text-2xl font-semibold text-gray-900">
                        What is on the agenda today?
                      </h2>
                      <p className="text-gray-600">
                        Start a conversation to get help with anything.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="mx-auto w-full max-w-4xl px-4 py-8">
                    {messages.map((message) => {
                      let userMessageContent: null | string = null;
                      if (message.role === "user") {
                        if (typeof message.content == "string") {
                          userMessageContent = message.content;
                        }
                      }
                      return (
                        <div
                          key={message.id}
                          className={`mb-8 ${message.role === "user" ? "text-right" : "text-left"}`}
                        >
                          <div
                            className={`${
                              message.role === "user"
                                ? "inline-block max-w-3xl bg-gray-900 text-white"
                                : "w-full bg-transparent text-gray-900"
                            } rounded-2xl px-6 py-4`}
                          >
                            {message.role === "assistant" && (
                              <div className="prose max-w-none">
                                <AnimatedMarkdown
                                  content={message.content ?? ""}
                                  animation="fadeIn"
                                  animationDuration="0.5s"
                                  animationTimingFunction="ease-in-out"
                                />
                              </div>
                            )}

                            {message.role === "user" && (
                              <p className="text-white">{userMessageContent}</p>
                            )}

                            {/* Loading spinner for assistant messages */}
                            {message.role === "assistant" &&
                              !message.content &&
                              !message.toolCalls &&
                              isLoading && (
                                <div className="mt-2 flex items-center gap-2">
                                  <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-gray-600"></div>
                                  <span className="text-sm text-gray-500">
                                    Thinking...
                                  </span>
                                </div>
                              )}

                            {message.role === "assistant" &&
                              message.generativeUI?.()}

                            {message.role === "tool" && (
                              <div className="mt-2 flex items-center gap-2">
                                <span className="text-sm text-gray-500">
                                  Called tool {message.toolName} and got:{" "}
                                  <span className="block pt-4 font-bold">
                                    {message.content || "nothing in response"}
                                  </span>
                                </span>
                              </div>
                            )}

                            {/* Action buttons for non-user messages (inside bubble) */}
                            {message.role !== "user" && (
                              <div className="mt-4 flex items-center gap-2">
                                <button
                                  onClick={() =>
                                    handleCopyMessage(
                                      typeof message.content === "string"
                                        ? message.content
                                        : JSON.stringify(message, null, 2),
                                    )
                                  }
                                  className="rounded p-1 text-gray-500 transition-colors hover:text-gray-700"
                                  title="Copy message"
                                >
                                  <svg
                                    className="h-4 w-4"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                    />
                                  </svg>
                                </button>

                                {/* Thumbs up/down only for assistant messages */}
                                {message.role === "assistant" &&
                                  message.content && (
                                    <>
                                      <button
                                        className="rounded p-1 text-gray-500 transition-colors hover:text-gray-700"
                                        title="Thumbs up"
                                      >
                                        <svg
                                          className="h-4 w-4"
                                          fill="none"
                                          stroke="currentColor"
                                          viewBox="0 0 24 24"
                                        >
                                          <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5"
                                          />
                                        </svg>
                                      </button>
                                      <button
                                        className="rounded p-1 text-gray-500 transition-colors hover:text-gray-700"
                                        title="Thumbs down"
                                      >
                                        <svg
                                          className="h-4 w-4"
                                          fill="none"
                                          stroke="currentColor"
                                          viewBox="0 0 24 24"
                                        >
                                          <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018c.163 0 .326.02.485.06L17 4m-7 10v5a2 2 0 002 2h.095c.5 0 .905-.405.905-.905 0-.714.211-1.412.608-2.006L17 13V4m-7 10h2"
                                          />
                                        </svg>
                                      </button>
                                    </>
                                  )}

                                <button
                                  onClick={() => handleShowDetails(message)}
                                  className="rounded p-1 text-gray-500 transition-colors hover:text-gray-700"
                                  title="Show details"
                                >
                                  <svg
                                    className="h-4 w-4"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                    />
                                  </svg>
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Action buttons for user messages (outside bubble) */}
                          {message.role === "user" && (
                            <div className="mt-2 flex items-center justify-end gap-2">
                              <button
                                onClick={() =>
                                  handleCopyMessage(
                                    typeof message.content === "string"
                                      ? message.content
                                      : JSON.stringify(message, null, 2),
                                  )
                                }
                                className="rounded p-1 text-gray-500 transition-colors hover:text-gray-700"
                                title="Copy message"
                              >
                                <svg
                                  className="h-4 w-4"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                  />
                                </svg>
                              </button>

                              <button
                                onClick={() => handleShowDetails(message)}
                                className="rounded p-1 text-gray-500 transition-colors hover:text-gray-700"
                                title="Show details"
                              >
                                <svg
                                  className="h-4 w-4"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                  />
                                </svg>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </StickToBottom.Content>
            </div>

            {/* Input Area */}
            <div className="flex-shrink-0 bg-white bg-opacity-50">
              <div className="mx-auto max-w-4xl p-4">
                <div className="mb-2 flex justify-center px-4">
                  <ScrollToBottomButton />
                </div>

                {/* Suggestions */}
                {suggestions && suggestions.length > 0 && (
                  <div className="mb-4 flex flex-wrap gap-2">
                    {suggestions.map((suggestion, index) => (
                      <button
                        key={index}
                        onClick={() => callSendMessage(suggestion.message)}
                        className="rounded-full bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-all duration-200 hover:bg-gray-200"
                      >
                        {suggestion.title}
                      </button>
                    ))}
                  </div>
                )}

                {/* Input Bar */}
                <div className="relative">
                  <div className="flex items-center rounded-3xl border border-gray-200 bg-gray-50 px-4 py-3">
                    <textarea
                      ref={textareaRef}
                      className="max-h-[200px] min-h-[20px] flex-1 resize-none overflow-y-auto border-none bg-transparent text-gray-900 placeholder-gray-500 outline-none"
                      placeholder="Ask anything"
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                      rows={1}
                    />
                    <button
                      onClick={handleSendMessage}
                      disabled={!newMessage.trim()}
                      className="ml-2 rounded-full bg-gray-900 p-2 text-white transition-all duration-200 hover:bg-gray-800 disabled:bg-gray-300"
                    >
                      <svg
                        className="h-5 w-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          {/* Interrupt */}
          {interrupt}
        </div>

        {/* Message Details Modal */}
        <MessageDetailsModal
          message={selectedMessage}
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
        />
      </StickToBottom>
    </>
  );
}
