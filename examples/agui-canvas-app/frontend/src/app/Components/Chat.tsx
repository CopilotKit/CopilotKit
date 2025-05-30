"use client";

import { CopilotChat, CopilotSidebar, useCopilotChatSuggestions } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
import { useChatContext } from "@copilotkit/react-ui";
import { FaRobot, FaComments, FaUsers } from "react-icons/fa";
import { useCoAgent } from "@copilotkit/react-core";
import { useEffect, useState, useRef } from "react";
import { useAgent } from "../Providers/AgentProvider";
import { Markdown } from "@copilotkit/react-ui";
const agents = [
    { id: "langgraphAgent", name: "LangGraph" },
    { id: "crewaiAgent", name: "CrewAI" },
    { id: "mastraAgent", name: "Mastra" },
];


export default function Chat() {
    const { selectedAgent, setSelectedAgent } = useAgent();
    // const { setOpen, open } = useChatContext();
    const { state, name } = useCoAgent({
        name: selectedAgent?.name,
        initialState: {
            document: "",
            status: "idle",
        }
    });

    // useCopilotChatSuggestions({
    //     instructions : "Generate suggestions for the user to generate documents for any topics"
    // })

    useEffect(() => {
        try {
            if (state.status === "completed") {
                console.log("[DEBUG] state.document", state.document)
                // console.log("[DEBUG] state.summary", fromMarkdown(state.document))
            }
        } catch (error) {
            console.log("[DEBUG] error", error)
        }

    }, [state]);

    const [dropdownOpen, setDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown on outside click
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && event.target instanceof Node && !dropdownRef.current.contains(event.target)) {
                setDropdownOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-950 to-blue-900 text-white">
            {/* Enhanced Fixed Header */}
            <header className="fixed top-0 left-0 w-full z-30 border-b border-gray-800 px-6 py-3 shadow-lg bg-gradient-to-r from-gray-900/95 via-gray-950/90 to-blue-900/90 backdrop-blur-md transition-all duration-500" style={{ height: '72px' }}>
                <div className="w-full flex items-center justify-between h-full">
                    {/* Left: Logo & App Name */}
                    <a href="/" className="flex items-center gap-2 group">
                        <img src="/copilotkit-logo-dark.webp" alt="logo" className="w-30 h-8 transition-transform duration-300 group-hover:scale-110" style={{ filter: 'drop-shadow(0 2px 8px #4299e1aa)' }} />
                        {/* <span className="text-2xl font-extrabold tracking-wide bg-gradient-to-r from-blue-400 via-blue-200 to-blue-500 bg-clip-text text-transparent drop-shadow-lg group-hover:brightness-125 transition-all duration-300">CopilotKit</span> */}
                    </a>
                    {/* Center: Navigation Links */}
                    <nav className="flex gap-10 items-center">
                        <a href="/" className="text-lg font-medium text-gray-200 hover:text-blue-400 transition-colors duration-200 relative after:absolute after:left-0 after:-bottom-1 after:w-0 after:h-0.5 after:bg-blue-400 after:transition-all after:duration-300 hover:after:w-full after:rounded-full">Home</a>
                        <a href="https://docs.copilotkit.ai" target="_blank" rel="noopener noreferrer" className="text-lg font-medium text-gray-200 hover:text-blue-400 transition-colors duration-200 relative after:absolute after:left-0 after:-bottom-1 after:w-0 after:h-0.5 after:bg-blue-400 after:transition-all after:duration-300 hover:after:w-full after:rounded-full">Docs</a>
                        <a href="https://github.com/CopilotKit/CopilotKit" target="_blank" rel="noopener noreferrer" className="text-lg font-medium text-gray-200 hover:text-blue-400 transition-colors duration-200 relative after:absolute after:left-0 after:-bottom-1 after:w-0 after:h-0.5 after:bg-blue-400 after:transition-all after:duration-300 hover:after:w-full after:rounded-full flex items-center gap-1">
                            <svg width="20" height="20" fill="currentColor" className="inline-block"><path d="M10 0C4.48 0 0 4.58 0 10.23c0 4.52 2.87 8.36 6.84 9.71.5.09.68-.22.68-.48 0-.24-.01-.87-.01-1.7-2.78.62-3.37-1.36-3.37-1.36-.45-1.18-1.1-1.5-1.1-1.5-.9-.63.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.05A9.38 9.38 0 0 1 10 5.8c.85.004 1.71.12 2.51.34 1.91-1.33 2.75-1.05 2.75-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.07.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.58.69.48C17.13 18.59 20 14.75 20 10.23 20 4.58 15.52 0 10 0z"/></svg>
                            GitHub
                        </a>
                    </nav>
                    {/* Right: Agent Dropdown, Avatar, Theme Toggle */}
                    <div className="flex items-center gap-4">
                        <div className="relative" ref={dropdownRef}>
                            <div
                                className={
                                    `flex items-center gap-2 bg-gray-800 text-white min-w-[150px] px-4 py-2 rounded-3xl border border-gray-700 cursor-pointer select-none transition-all duration-300 ` +
                                    (dropdownOpen ? "ring-2 ring-blue-500" : "hover:bg-gray-700")
                                }
                                onClick={() => setDropdownOpen((open) => !open)}
                                tabIndex={0}
                                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") setDropdownOpen(o => !o); }}
                                aria-haspopup="listbox"
                                aria-expanded={dropdownOpen}
                            >
                                <span className="flex-1 text-center">
                                    {agents.find(a => a.id === selectedAgent?.name)?.name || "Select Agent"}
                                </span>
                                <span className={`ml-2 transition-transform duration-200 ${dropdownOpen ? "rotate-180" : "rotate-0"}`}>▼</span>
                            </div>
                            {dropdownOpen && (
                                <div className="absolute right-0 mt-2 w-full min-w-[140px] bg-gray-900 border border-gray-700 rounded-xl shadow-lg z-50 animate-fadeIn">
                                    {agents.map((agent) => (
                                        <div
                                            key={agent.id}
                                            className={`px-4 py-2 text-center cursor-pointer hover:bg-blue-700/80 transition-colors rounded-xl ${selectedAgent?.name === agent.id ? "bg-blue-800/80 text-white font-bold" : "text-gray-200"}`}
                                            onClick={() => { setSelectedAgent({ name: agent.id }); setDropdownOpen(false); }}
                                            role="option"
                                            aria-selected={selectedAgent?.name === agent.id}
                                        >
                                            {agent.name}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        {/* User Avatar Placeholder */}
                        <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-500 via-blue-300 to-blue-700 flex items-center justify-center shadow-md border-2 border-blue-400 cursor-pointer hover:scale-105 transition-transform duration-200">
                            <span className="font-bold text-lg text-white select-none">CK</span>
                        </div>
                    </div>
                </div>
            </header>
            {/* Fixed Sidebar */}
            <aside className="fixed top-[72px] left-0 w-90 min-h-[calc(100vh-72px)] bg-gray-950/70 flex-shrink-0 flex flex-col items-center justify-start shadow-2xl backdrop-blur-lg z-20 animate-fadeIn" style={{ boxShadow: '0 8px 32px 0 rgba(66,153,225,0.15)', height: 'calc(100vh - 72px)' }}>
                <CopilotChat className="w-full h-full px-2" />
                {/* Shimmer effect for CopilotKit branding */}
                <div className="absolute bottom-2 left-0 w-full text-center">
                    <span className="text-xs text-blue-300 shimmer">Powered by CopilotKit</span>
                </div>
            </aside>
            {/* Main Content Area (scrollable) */}
            <main className="ml-[22.5rem] pt-[72px] min-h-screen h-[calc(100vh-72px)] overflow-y-auto transition-all duration-500">
                <div className="flex flex-col flex-1 min-h-full">
                    {/* Centered Landing Section */}
                    <section className="flex flex-1 flex-col items-center justify-center py-16 px-4 bg-transparent text-center min-h-[80vh] transition-all duration-500">
                        {/* Loader when processing */}
                        {state.status === "processing" && (
                            <div className="flex flex-col items-center justify-center h-full animate-fadeIn">
                                <div className="dot-loader mb-6">
                                    <span className="dot"></span>
                                    <span className="dot"></span>
                                    <span className="dot"></span>
                                </div>
                                <span className="text-lg text-blue-400 animate-pulse">Processing your request...</span>
                            </div>
                        )}
                        {/* Canvas for AI response when completed */}
                        {state.status === "completed" && (
                            <div className="flex flex-col items-center justify-center h-full w-full animate-fadeIn">
                                <div className="bg-gray-800/90 rounded-lg shadow-2xl p-8 w-full max-w-2xl min-h-[300px] flex items-start justify-center transition-all duration-500">
                                    <div
                                        className="prose prose-invert prose-lg max-w-2xl text-left p-8 rounded-lg shadow bg-gray-800/80 marker:text-blue-400 list-disc"
                                    >
                                        <div className="copilotKitMarkdown">
                                            <Markdown content={state.document.startsWith("```markdown") ? state.document.slice(11, -3) : state.document} />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                        {/* Default landing content */}
                        {state.status !== "processing" && state.status !== "completed" && (
                            <>
                                <div className="flex justify-center gap-8 mb-8 text-blue-400 text-6xl">
                                    <span className="animate-staggerFadeIn" style={{ animationDelay: '0.1s' }}><FaRobot title="AI Agent" /></span>
                                    <span className="animate-staggerFadeIn" style={{ animationDelay: '0.3s' }}><FaComments title="Chat" /></span>
                                    <span className="animate-staggerFadeIn" style={{ animationDelay: '0.5s' }}><FaUsers title="Multiple Agents" /></span>
                                </div>
                                <h2 className="text-4xl font-bold mb-4 drop-shadow-lg animate-fadeIn">Welcome to AGUI Chat!</h2>
                                <p className="text-lg text-gray-300 max-w-2xl mb-8 animate-fadeIn" style={{ animationDelay: '0.6s' }}>
                                    Chat with different AI agents (LangGraph, CrewAI, Mastra) using the dropdown above. Select an agent and start your conversation below!
                                </p>
                            </>
                        )}
                    </section>
                    {/* Loader CSS and Animations */}
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
                            background: linear-gradient(135deg, #4299e1 60%, #90cdf4 100%);
                            border-radius: 50%;
                            display: inline-block;
                            animation: bounce 1.2s infinite cubic-bezier(0.68, -0.55, 0.27, 1.55) both;
                            box-shadow: 0 0 12px #4299e1aa;
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
                                transform: scale(0.7) translateY(0);
                                opacity: 0.7;
                            }
                            40% {
                                transform: scale(1.2) translateY(-12px);
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
                        select {
                            appearance: none;
                            -webkit-appearance: none;
                            -moz-appearance: none;
                            padding-right: 2.0em;
                        }
                        /* Animations */
                        @keyframes fadeIn {
                            from { opacity: 0; transform: translateY(20px); }
                            to { opacity: 1; transform: none; }
                        }
                        .animate-fadeIn {
                            animation: fadeIn 0.8s cubic-bezier(0.4,0,0.2,1) both;
                        }
                        @keyframes staggerFadeIn {
                            from { opacity: 0; transform: scale(0.7) translateY(20px); }
                            to { opacity: 1; transform: scale(1) translateY(0); }
                        }
                        .animate-staggerFadeIn {
                            animation: staggerFadeIn 0.7s cubic-bezier(0.4,0,0.2,1) both;
                        }
                        @keyframes glow {
                            0%, 100% { box-shadow: 0 0 0px #4299e1; }
                            50% { box-shadow: 0 0 16px #4299e1cc; }
                        }
                        .animate-glow {
                            animation: glow 2s infinite;
                        }
                        /* Shimmer for CopilotKit */
                        .shimmer {
                            background: linear-gradient(90deg, #4299e1 0%, #90cdf4 50%, #4299e1 100%);
                            background-size: 200% 100%;
                            -webkit-background-clip: text;
                            -webkit-text-fill-color: transparent;
                            animation: shimmer 2.5s linear infinite;
                        }
                        @keyframes shimmer {
                            0% { background-position: 200% 0; }
                            100% { background-position: -200% 0; }
                        }
                    `}</style>
                </div>
            </main>
        </div>
    );
}