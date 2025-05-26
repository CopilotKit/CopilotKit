"use client";

import { CopilotSidebar, useCopilotChatSuggestions } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
import { useChatContext } from "@copilotkit/react-ui";
import { FaRobot, FaComments, FaUsers } from "react-icons/fa";
import { useCoAgent } from "@copilotkit/react-core";
import { useEffect } from "react";

const agents = [
    { id: "langgraph", name: "LangGraph" },
    { id: "crewai", name: "CrewAI" },
    { id: "mastra", name: "Mastra" },
];

function simpleMarkdownToHtml(md: string): string {
    // Headings
    md = md.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    md = md.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    md = md.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    // Bold
    md = md.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>');
    // Italic
    md = md.replace(/\*(.*?)\*/gim, '<em>$1</em>');
    // Unordered List
    md = md.replace(/^\s*[-*+] (.*)$/gim, '<li>$1</li>');
    md = md.replace(/(<li>.*<\/li>)/gim, '<ul>$1</ul>');
    // Line breaks
    md = md.replace(/\n$/gim, '<br />');
    return md.trim();
}

export default function Chat() {
    const { setOpen, open } = useChatContext();
    const { state, name } = useCoAgent({
        name : "langgraphAgent",
        initialState : {
            document : "",
            status : "idle",
        }
    });

    // useCopilotChatSuggestions({
    //     instructions : "Generate suggestions for the user to generate documents for any topics"
    // })

    useEffect(() => {
        console.log("[DEBUG] state",state.status);
        console.log("[DEBUG] name",name);
    }, [state.status, state.document]);

    return (
        <div className="flex flex-col min-h-screen bg-gray-900 text-white">
            {/* Header */}
            <header className="border-b border-gray-700 p-4">
                <div className="w-full mx-auto flex justify-between items-center">
                    <img src="/copilotkit-logo-dark.webp" alt="logo" className="w-30 h-8" />
                    <h1 className="text-xl font-bold">AGUI Chat Interface</h1>
                    <div>
                        <select
                            className="bg-gray-800 text-white px-4 py-2 rounded-3xl border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            {agents.map((agent) => (
                                <option key={agent.id} value={agent.id}>
                                    {agent.name}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
            </header>

            {/* Centered Landing Section */}
            <section className="flex flex-1 flex-col items-center justify-center py-16 px-4 bg-gray-900 text-center min-h-[80vh]">
                {/* Loader when processing */}
                {state.status === "processing" && (
                    <div className="flex flex-col items-center justify-center h-full">
                        <div className="dot-loader mb-6">
                            <span className="dot"></span>
                            <span className="dot"></span>
                            <span className="dot"></span>
                        </div>
                        <span className="text-lg text-blue-400">Processing your request...</span>
                    </div>
                )}
                {/* Canvas for AI response when completed */}
                {state.status === "completed" && (
                    <div className="flex flex-col items-center justify-center h-full w-full">
                        <div className="bg-gray-800 border border-blue-500 rounded-lg shadow-lg p-8 w-full max-w-2xl min-h-[300px] flex items-start justify-center">
                            <div
                                className="prose prose-invert prose-lg max-w-2xl text-left p-8 rounded-lg shadow bg-gray-800 marker:text-blue-400 list-disc"
                                style={{ margin: 0 }}
                                dangerouslySetInnerHTML={{ __html: simpleMarkdownToHtml(state.document || "No response.") }}
                            />
                        </div>
                    </div>
                )}
                {/* Default landing content */}
                {state.status !== "processing" && state.status !== "completed" && (
                    <>
                        <div className="flex justify-center gap-8 mb-8 text-blue-400 text-6xl">
                            <FaRobot title="AI Agent" />
                            <FaComments title="Chat" />
                            <FaUsers title="Multiple Agents" />
                        </div>
                        <h2 className="text-4xl font-bold mb-4">Welcome to AGUI Chat!</h2>
                        <p className="text-lg text-gray-300 max-w-2xl mb-8">
                            Chat with different AI agents (LangGraph, CrewAI, Mastra) using the dropdown above. Select an agent and start your conversation below!
                        </p>
                        <div className="flex justify-center">
                            <button
                                className="bg-gray-800 border border-gray-700 text-white px-6 py-2 rounded-lg font-medium hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all duration-150 shadow"
                                onClick={() => setOpen(true)}
                                hidden={open}
                            >
                                Explore Now
                            </button>
                        </div>
                    </>
                )}
            </section>
            {/* Loader CSS */}
            <style jsx>{`
                .dot-loader {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 0.5rem;
                    height: 60px;
                }
                .dot {
                    width: 16px;
                    height: 16px;
                    background: #4299e1;
                    border-radius: 50%;
                    display: inline-block;
                    animation: bounce 1.2s infinite ease-in-out both;
                }
                .dot:nth-child(1) {
                    animation-delay: -0.24s;
                }
                .dot:nth-child(2) {
                    animation-delay: -0.12s;
                }
                .dot:nth-child(3) {
                    animation-delay: 0;
                }
                @keyframes bounce {
                    0%, 80%, 100% {
                        transform: scale(0.7);
                        opacity: 0.7;
                    }
                    40% {
                        transform: scale(1.2);
                        opacity: 1;
                    }
                }
                .prose ul {
                    list-style-type: disc !important;
                    margin-left: 1.5rem !important;
                }
                .prose li {
                    margin-bottom: 0.5rem !important;
                }
            `}</style>
        </div>
    );
}