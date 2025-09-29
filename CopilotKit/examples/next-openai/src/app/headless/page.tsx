"use client";

import {
  CopilotKit,
  useCoAgentStateRender,
  useCopilotAction,
  useCopilotChatHeadless_c,
  useLangGraphInterrupt,
} from "@copilotkit/react-core";
import { CopilotSidebar, useCopilotChatSuggestions } from "@copilotkit/react-ui";
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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
        <div className="bg-gray-800 text-white p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold">Message Details</h3>
            <button
              onClick={onClose}
              className="text-white/80 hover:text-white transition-colors rounded-full p-1 hover:bg-white/10"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
        <div className="p-6 overflow-y-auto max-h-[calc(80vh-100px)]">
          <pre className="bg-gray-50 rounded-lg p-4 text-sm overflow-x-auto text-gray-800">
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
    searchParams.get("runtimeUrl") || `/api/copilotkit?serviceAdapter=${serviceAdapter}`;
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
      className="bg-gray-800 hover:bg-gray-900 text-white rounded-full p-2 shadow-lg hover:shadow-xl transition-all duration-200"
      onClick={() => scrollToBottom()}
      title="Scroll to bottom"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [newMessage]);

  useCoAgentStateRender({
    name: "agent",
    render: (state) => {
      return (
        <details className="mb-4">
          <summary className="cursor-pointer text-sm text-gray-600">Agent State</summary>
          <pre className="text-xs bg-gray-100 p-2 rounded mt-2 overflow-auto">
            {JSON.stringify(state, null, 2)}
          </pre>
        </details>
      );
    },
  });

  useLangGraphInterrupt({
    render: ({ event, resolve, result }) => {
      return (
        <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <details>
            <summary className="cursor-pointer text-sm font-medium text-yellow-800">
              LangGraph Interrupt
            </summary>
            <pre className="text-xs mt-2">{JSON.stringify({ result, event }, null, 2)}</pre>
          </details>
          <button
            onClick={() => resolve("the secret is 1234")}
            className="mt-2 px-3 py-1 bg-yellow-600 text-white text-sm rounded hover:bg-yellow-700"
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
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4 my-2 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
              <svg
                className="w-4 h-4 text-blue-600"
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
            <div className="text-blue-700 font-medium">🔧 Generative UI Activated</div>
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
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4 my-2 shadow-sm">
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
        <div className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-xl p-4 my-2 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
              <svg
                className="w-4 h-4 text-purple-600"
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
            <div className="text-purple-700 font-medium text-sm">🔧 Waiting for Response</div>
          </div>
          <button
            onClick={() => props.respond?.("the secret is 120")}
            className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-200 shadow-sm"
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
        <div className="bg-gradient-to-r from-amber-50 via-orange-50 to-red-50 border border-amber-200 rounded-xl p-4 my-2 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center">
              <svg
                className="w-4 h-4 text-amber-600"
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
            <div className="text-amber-700 font-medium">✨ Poem Generator Activated</div>
          </div>
          <div className="bg-white/60 rounded-lg p-3 border border-amber-100">
            <div className="text-xs text-amber-600 font-medium mb-2">Generated Content:</div>
            <div className="text-amber-800 font-medium text-sm">{props.args.generatedPoem}</div>
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
      { title: "Tool with handler", message: "Please call the toolWithHandler tool" },
      { title: "Poem Generator", message: "Please call the poemGenerator tool" },
      { title: "Human-in-the-loop", message: "Please call the Human-in-the-loop tool" },
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
        <div className="h-screen w-screen flex flex-col">
          {/* Main Chat Area */}
          <div className="flex-1 flex flex-col min-h-0">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto">
              <StickToBottom.Content className="flex flex-col h-full">
                {messages.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center h-full">
                    <div className="text-center">
                      <div className="text-4xl mb-4">💬</div>
                      <h2 className="text-2xl font-semibold text-gray-900 mb-2">
                        What is on the agenda today?
                      </h2>
                      <p className="text-gray-600">
                        Start a conversation to get help with anything.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="max-w-4xl mx-auto w-full px-4 py-8">
                    {messages.map((message) => (
                      <div
                        key={message.id}
                        className={`mb-8 ${message.role === "user" ? "text-right" : "text-left"}`}
                      >
                        <div
                          className={`${
                            message.role === "user"
                              ? "inline-block max-w-3xl bg-gray-900 text-white"
                              : "w-full text-gray-900 bg-transparent"
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
                            <p className="text-white">{message.content}</p>
                          )}

                          {/* Loading spinner for assistant messages */}
                          {message.role === "assistant" &&
                            !message.content &&
                            !message.toolCalls &&
                            isLoading && (
                              <div className="flex items-center gap-2 mt-2">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
                                <span className="text-sm text-gray-500">Thinking...</span>
                              </div>
                            )}

                          {message.role === "assistant" && message.generativeUI?.()}

                          {message.role === "tool" && (
                            <div className="flex items-center gap-2 mt-2">
                              <span className="text-sm text-gray-500">
                                Called tool {message.toolName} and got:{" "}
                                <span className="font-bold block pt-4">
                                  {message.content || "nothing in response"}
                                </span>
                              </span>
                            </div>
                          )}

                          {/* Action buttons for non-user messages (inside bubble) */}
                          {message.role !== "user" && (
                            <div className="flex items-center gap-2 mt-4">
                              <button
                                onClick={() =>
                                  handleCopyMessage(
                                    message.content || JSON.stringify(message, null, 2),
                                  )
                                }
                                className="text-gray-500 hover:text-gray-700 p-1 rounded transition-colors"
                                title="Copy message"
                              >
                                <svg
                                  className="w-4 h-4"
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
                              {message.role === "assistant" && message.content && (
                                <>
                                  <button
                                    className="text-gray-500 hover:text-gray-700 p-1 rounded transition-colors"
                                    title="Thumbs up"
                                  >
                                    <svg
                                      className="w-4 h-4"
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
                                    className="text-gray-500 hover:text-gray-700 p-1 rounded transition-colors"
                                    title="Thumbs down"
                                  >
                                    <svg
                                      className="w-4 h-4"
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
                                className="text-gray-500 hover:text-gray-700 p-1 rounded transition-colors"
                                title="Show details"
                              >
                                <svg
                                  className="w-4 h-4"
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
                          <div className="flex items-center justify-end gap-2 mt-2">
                            <button
                              onClick={() =>
                                handleCopyMessage(
                                  message.content || JSON.stringify(message, null, 2),
                                )
                              }
                              className="text-gray-500 hover:text-gray-700 p-1 rounded transition-colors"
                              title="Copy message"
                            >
                              <svg
                                className="w-4 h-4"
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
                              className="text-gray-500 hover:text-gray-700 p-1 rounded transition-colors"
                              title="Show details"
                            >
                              <svg
                                className="w-4 h-4"
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
                    ))}
                  </div>
                )}
              </StickToBottom.Content>
            </div>

            {/* Input Area */}
            <div className="bg-white flex-shrink-0 bg-opacity-50">
              <div className="max-w-4xl mx-auto p-4">
                <div className="flex justify-center mb-2 px-4">
                  <ScrollToBottomButton />
                </div>

                {/* Suggestions */}
                {suggestions && suggestions.length > 0 && (
                  <div className="mb-4 flex flex-wrap gap-2">
                    {suggestions.map((suggestion, index) => (
                      <button
                        key={index}
                        onClick={() => callSendMessage(suggestion.message)}
                        className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200"
                      >
                        {suggestion.title}
                      </button>
                    ))}
                  </div>
                )}

                {/* Input Bar */}
                <div className="relative">
                  <div className="flex bg-gray-50 border border-gray-200 rounded-3xl px-4 py-3 items-center">
                    <textarea
                      ref={textareaRef}
                      className="flex-1 bg-transparent border-none outline-none text-gray-900 placeholder-gray-500 resize-none min-h-[20px] max-h-[200px] overflow-y-auto"
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
                      className="bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 text-white p-2 rounded-full transition-all duration-200 ml-2"
                    >
                      <svg
                        className="w-5 h-5"
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
