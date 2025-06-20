"use client";

import { CopilotKit, useCoAgentStateRender, useCopilotAction, useCopilotChat, useLangGraphInterrupt } from "@copilotkit/react-core";
import { CopilotChat, CopilotSidebar, useCopilotChatSuggestions } from "@copilotkit/react-ui";
import { randomId } from "@copilotkit/shared";
import { AnimatedMarkdown } from "flowtoken";
import { useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom';
import 'flowtoken/dist/styles.css';

// Modal Component
function MessageDetailsModal({ message, isOpen, onClose }: { 
  message: any; 
  isOpen: boolean; 
  onClose: () => void; 
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold">Message Details</h3>
            <button
              onClick={onClose}
              className="text-white/80 hover:text-white transition-colors rounded-full p-1 hover:bg-white/10"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
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
  const copilotKitProps: Partial<React.ComponentProps<typeof CopilotKit>> = {
    runtimeUrl,
    publicApiKey: process.env.NEXT_PUBLIC_COPILOT_KIT_PUBLIC_API_KEY || undefined,
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
      <CopilotKit {...copilotKitProps}>
        <TravelPlanner />
      </CopilotKit>
    </div>
  );
}

function ScrollToBottomButton() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  if (isAtBottom) return null;

  return (
    <button
      className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white rounded-full p-3 shadow-lg hover:shadow-xl transition-all duration-200 z-10"
      onClick={() => scrollToBottom()}
      title="Scroll to bottom"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    </button>
  );
}

function TravelPlanner() {
  const chat = useCopilotChat();
  const [newMessage, setNewMessage] = useState("");
  const [selectedMessage, setSelectedMessage] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useCoAgentStateRender({
    name: "agent",
    render: (state) => {
      return (
        <details>
          <summary>Travel State</summary>
          <pre>{JSON.stringify(state, null, 2)}</pre>
        </details>
      );
    },
  })

  useLangGraphInterrupt({
    render: ({event, resolve, result}) => {
      return (
        <div>
          <details>
            <summary>LangGraph Interrupt</summary>
            <pre>{JSON.stringify({reuslt: result, event: event}, null,  2)}</pre>
          </details>
          <button onClick={() => resolve("the secret is 1234")}>Resolve</button>
        </div>
      );
    },
  })

  useCopilotAction({
    name: "tool1",
    description: "Tool 1",
    render: () => {
      return (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4 my-2">
          <div className="text-blue-700 font-medium">🔧 Tool 1 Activated</div>
        </div>
      );
    },
  });

  useCopilotAction({
    name: "tool2",
    description: "Tool 2",
    handler: () => {
      alert("tool2");
      return "the secret is 42";
    },
  });

  useCopilotAction({
    name: "tool3",
    description: "Tool 3",
    renderAndWaitForResponse: (props) => {
      return (
        <div className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-xl p-4 my-2">
          <div className="text-purple-700 font-medium mb-3">🔧 Tool 3 Waiting for Response</div>
          <button 
            onClick={() => props.respond?.("the secret is 120")}
            className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white px-4 py-2 rounded-lg transition-all duration-200 shadow-md hover:shadow-lg"
          >
            Respond
          </button>
          <details className="mt-3">
            <summary className="text-sm text-purple-600 cursor-pointer hover:text-purple-700">Show Details</summary>
            <div className="mt-2 text-xs bg-purple-100 rounded p-2">{JSON.stringify(props)}</div>
          </details>
        </div>
      );
    },
  });
  
  useCopilotChatSuggestions({
    instructions: "Suggest helpful travel-related topics and questions about trip planning, destinations, and travel tips.",
    minSuggestions: 3,
  });

  const handleSendMessage = useCallback(() => {
    chat.appendMessage({
      id: randomId(),
      role: "user",
      content: newMessage,
    });
    setNewMessage("");
  }, [chat, newMessage]);

  const handleSuggestionClick = useCallback((suggestion: { title: string; message: string }) => {
    chat.appendMessage({
      id: randomId(),
      role: "user",
      content: suggestion.message,
    });
  }, [chat]);

  const handleShowDetails = useCallback((message: any) => {
    setSelectedMessage(message);
    setIsModalOpen(true);
  }, []);

  // Manual suggestion examples
  const setCustomSuggestions = useCallback(() => {
    chat.setSuggestions([
      { title: "Plan a trip", message: "Help me plan a 7-day trip to Japan" },
      { title: "Find hotels", message: "What are the best hotels in Tokyo?" },
      { title: "Local cuisine", message: "Tell me about Japanese food I must try" }
    ]);
  }, [chat]);

  const setCodingSuggestions = useCallback(() => {
    chat.setSuggestions([
      { title: "Debug code", message: "Help me debug this React component" },
      { title: "Code review", message: "Can you review my TypeScript code?" },
      { title: "Best practices", message: "What are React best practices?" }
    ]);
  }, [chat]);

  const clearSuggestions = useCallback(() => {
    chat.setSuggestions([]);
  }, [chat]);

  const reloadAISuggestions = useCallback(async () => {
    await chat.reloadSuggestions();
  }, [chat]);

  return (
    <>
      <CopilotSidebar clickOutsideToClose={false} />
      <div className="h-screen w-screen flex p-6">
        {/* Chat Messages Section */}
        <div className="w-1/2 pr-4">
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl shadow-2xl h-full p-6">
            <h2 className="text-2xl font-bold text-white mb-6 flex items-center">
              <svg className="w-7 h-7 mr-3 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              Chat Messages
            </h2>
            
            <StickToBottom className="h-5/6 relative" resize="smooth" initial="smooth">
              <StickToBottom.Content className="flex flex-col space-y-4">
                {chat.visibleMessages.length === 0 ? (
                  <div className="text-white/60 italic text-center py-12">
                    <div className="text-4xl mb-4">💬</div>
                    No messages yet. Start a conversation!
                  </div>
                ) : (
                  chat.visibleMessages.map((message) => (
                    <div key={message.id} className={`group relative ${
                      message.role === 'user' 
                        ? 'ml-8'
                        : 'mr-8'
                    }`}>
                      <div className={`rounded-2xl p-4 shadow-lg ${
                        message.role === 'user'
                          ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white'
                          : 'bg-white/95 backdrop-blur-sm text-gray-800'
                      }`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className={`text-xs font-medium uppercase tracking-wide ${
                            message.role === 'user' ? 'text-blue-100' : 'text-gray-500'
                          }`}>
                            {message.role === 'user' ? '👤 You' : message.role === 'assistant' ? '🤖 Assistant' : message.role }
                          </div>
                          <button
                            onClick={() => handleShowDetails(message)}
                            className={`opacity-0 group-hover:opacity-100 transition-opacity duration-200 rounded-full p-1 hover:bg-black/10 ${
                              message.role === 'user' ? 'text-blue-100 hover:text-white' : 'text-gray-400 hover:text-gray-600'
                            }`}
                            title="Show details"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </button>
                        </div>
                        
                        <div className="prose max-w-none">
                          <AnimatedMarkdown
                            content={message.content ?? ""}
                            animation="fadeIn"
                            animationDuration="1s"
                            animationTimingFunction="ease-in-out"
                          />
                        </div>
                        
                        {message.role === "assistant" && message.render?.()}
                      </div>
                    </div>
                  ))
                )}
              </StickToBottom.Content>
              
              <ScrollToBottomButton />
            </StickToBottom>
          </div>
        </div>

        {/* Input and Suggestions Section */}
        <div className="w-1/2 pl-4 flex flex-col space-y-6">
          {/* Message Input */}
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl shadow-2xl p-6">
            <h2 className="text-2xl font-bold text-white mb-6 flex items-center">
              <svg className="w-7 h-7 mr-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Send Message
            </h2>
            
            <div className="space-y-4">
              <textarea 
                className="w-full p-4 bg-white/90 backdrop-blur-sm border-0 rounded-xl resize-none text-gray-800 placeholder-gray-500 focus:ring-2 focus:ring-blue-400 focus:outline-none transition-all duration-200"
                rows={4}
                placeholder="Type your message here..."
                value={newMessage} 
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
              />
              <button 
                className="w-full bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 disabled:from-gray-400 disabled:to-gray-500 text-white py-3 px-6 rounded-xl font-medium transition-all duration-200 shadow-lg hover:shadow-xl disabled:shadow-none"
                onClick={handleSendMessage}
                disabled={!newMessage.trim()}
              >
                {!newMessage.trim() ? 'Enter a message...' : 'Send Message ✨'}
              </button>
            </div>
          </div>

          {/* Manual Suggestion Controls */}
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl shadow-2xl p-6">
            <h3 className="text-xl font-bold text-white mb-4 flex items-center">
              <svg className="w-6 h-6 mr-3 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4" />
              </svg>
              Manual Suggestions
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={setCustomSuggestions}
                className="bg-gradient-to-r from-green-500 to-teal-500 hover:from-green-600 hover:to-teal-600 text-white py-2 px-4 rounded-lg font-medium transition-all duration-200 shadow-md hover:shadow-lg text-sm"
              >
                🌎 Travel
              </button>
              <button
                onClick={setCodingSuggestions}
                className="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white py-2 px-4 rounded-lg font-medium transition-all duration-200 shadow-md hover:shadow-lg text-sm"
              >
                💻 Coding
              </button>
              <button
                onClick={reloadAISuggestions}
                className="bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white py-2 px-4 rounded-lg font-medium transition-all duration-200 shadow-md hover:shadow-lg text-sm"
              >
                🤖 AI Reload
              </button>
              <button
                onClick={clearSuggestions}
                className="bg-gradient-to-r from-gray-500 to-gray-600 hover:from-gray-600 hover:to-gray-700 text-white py-2 px-4 rounded-lg font-medium transition-all duration-200 shadow-md hover:shadow-lg text-sm"
              >
                🗑️ Clear All
              </button>
            </div>
          </div>

          {/* Suggestions */}
          {chat.suggestions && chat.suggestions.length > 0 && (
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl shadow-2xl p-6 flex-1">
              <h3 className="text-xl font-bold text-white mb-4 flex items-center">
                <svg className="w-6 h-6 mr-3 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                Suggestions
              </h3>
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {chat.suggestions.map((suggestion, index) => (
                  <button
                    key={index}
                    onClick={() => handleSuggestionClick(suggestion)}
                    className="w-full text-left p-4 bg-white/90 hover:bg-white backdrop-blur-sm rounded-xl border-0 transition-all duration-200 shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
                  >
                    <div className="font-medium text-gray-900 mb-1">{suggestion.title}</div>
                    <div className="text-sm text-gray-600">{suggestion.message}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        {/* Interrupt */}
        {chat.interrupt}
      </div>

      {/* Message Details Modal */}
      <MessageDetailsModal 
        message={selectedMessage}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
}
