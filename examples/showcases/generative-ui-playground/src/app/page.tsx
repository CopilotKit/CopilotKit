"use client";

import { useState, useEffect } from "react";
// All modes use @copilotkit packages
import {
  CopilotKitProvider,
  CopilotSidebar,
  CopilotPopup,
} from "@copilotkit/react-core/v2";
import { useMediaQuery } from "@/hooks/use-media-query";
// Mode-specific wrappers with their own CopilotKitProvider configurations
import { A2UIPage } from "./components/A2UIPage";
import { OpenGenUIPage } from "./components/OpenGenUIPage";
import { CopilotContextProvider } from "./components/CopilotContextProvider";
import { StaticGenUICard } from "./components/protocol-cards/StaticGenUICard";
import { MCPAppsCard } from "./components/protocol-cards/MCPAppsCard";
import { A2UICard } from "./components/protocol-cards/A2UICard";
import { OpenGenUICard } from "./components/protocol-cards/OpenGenUICard";
import { ComparisonTable } from "./components/ComparisonTable";
import { PromptPill } from "./components/PromptPill";
import { useSendMessage } from "./hooks/useSendMessage";
import "@copilotkit/react-core/v2/styles.css";

// Shared page content component - rendered inside either provider
function PageContent({
  activeAgent,
  setActiveAgent,
  onPillClick,
}: {
  activeAgent: "default" | "a2ui" | "opengenui";
  setActiveAgent: (agent: "default" | "a2ui" | "opengenui") => void;
  onPillClick: (
    prompt: string,
    targetMode: "default" | "a2ui" | "opengenui",
  ) => void;
}) {
  const { sendMessage } = useSendMessage();

  // Processing pending messages is no longer needed with the Unified Provider
  // as the context is preserved across tab switches.

  return (
    <>
      {/* Abstract animated background */}
      <div className="abstract-bg">
        <div className="blob-3" />
      </div>

      {/* Main content with sidebar */}
      <div className="flex min-h-screen">
        {/* Left panel - Protocol info */}
        <div className="relative z-10 flex-1 p-4 md:p-8 overflow-auto">
          <div className="max-w-3xl mx-auto">
            {/* Header */}
            <header className="text-center mb-8">
              <div className="flex justify-center items-center gap-4 mb-4">
                <h1 className="text-2xl md:text-4xl font-bold">
                  <span className="text-gradient">Generative UI</span> Specs
                </h1>
                <a
                  href="https://a2ui-composer.ag-ui.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 text-sm bg-[#9f8fef]/20 text-[#383b99] rounded-full hover:bg-[#9f8fef]/30 transition-colors font-medium"
                >
                  Widget Builder ↗
                </a>
              </div>
              <p className="text-lg text-[var(--color-text-secondary)] max-w-2xl mx-auto">
                Explore four approaches to building AI-powered user interfaces
                with CopilotKit
              </p>
              <div className="flex justify-center gap-3 mt-4">
                <a
                  href="https://go.copilotkit.ai/generative-ui"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 text-sm bg-gradient-to-r from-[#9f8fef] to-[#7dd3c0] text-white rounded-full hover:opacity-90 transition-opacity font-medium"
                >
                  Read more ↗
                </a>
                <a
                  href="https://go.copilotkit.ai/generative-ui-specs"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 text-sm bg-white/10 backdrop-blur border border-white/20 text-[var(--color-text-primary)] rounded-full hover:bg-white/20 transition-colors font-medium"
                >
                  Docs ↗
                </a>
              </div>
            </header>

            {/* Agent Switching Tabs */}
            <div className="flex justify-center gap-4 mb-8">
              <button
                onClick={() => setActiveAgent("default")}
                className={`protocol-tab ${activeAgent === "default" ? "active" : ""}`}
              >
                <span className="flex items-center gap-2">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M9 9h6v6H9z" />
                  </svg>
                  Static + MCP Apps
                </span>
              </button>
              <button
                onClick={() => setActiveAgent("a2ui")}
                className={`protocol-tab ${activeAgent === "a2ui" ? "active" : ""}`}
              >
                <span className="flex items-center gap-2">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 6v6l4 2" />
                  </svg>
                  A2UI
                </span>
              </button>
              <button
                onClick={() => setActiveAgent("opengenui")}
                className={`protocol-tab ${activeAgent === "opengenui" ? "active" : ""}`}
              >
                <span className="flex items-center gap-2">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M12 2L2 7l10 5 10-5-10-5z" />
                    <path d="M2 17l10 5 10-5" />
                    <path d="M2 12l10 5 10-5" />
                  </svg>
                  Open Generative UI
                </span>
              </button>
            </div>

            {/* Protocol Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              <StaticGenUICard
                isActive={activeAgent === "default"}
                onPromptClick={(prompt) => onPillClick(prompt, "default")}
              />
              <MCPAppsCard
                isActive={activeAgent === "default"}
                onPromptClick={(prompt) => onPillClick(prompt, "default")}
              />
              <A2UICard
                isActive={activeAgent === "a2ui"}
                onPromptClick={(prompt) => onPillClick(prompt, "a2ui")}
              />
              <OpenGenUICard
                isActive={activeAgent === "opengenui"}
                onPromptClick={(prompt) => onPillClick(prompt, "opengenui")}
              />
            </div>

            {/* Comparison Table */}
            <ComparisonTable />

            {/* Example Prompts */}
            <div className="mt-8 text-center">
              <p className="text-[var(--color-text-tertiary)] mb-4">
                Try these prompts in the chat:
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {activeAgent === "default" ? (
                  <>
                    <PromptPill prompt="What's the weather in Tokyo?" />
                    <PromptPill prompt="Get stock price for AAPL" />
                    <PromptPill prompt="Open the calculator" />
                    <PromptPill prompt="Search for flights to Paris" />
                  </>
                ) : activeAgent === "a2ui" ? (
                  <>
                    <PromptPill prompt="Find Italian restaurants nearby" />
                    <PromptPill prompt="Show me Chinese food options" />
                    <PromptPill prompt="Book a table for 4" />
                  </>
                ) : (
                  <>
                    <PromptPill prompt="Build a bar chart of quarterly revenue" />
                    <PromptPill prompt="Create a spreadsheet with sales data" />
                    <PromptPill prompt="Make a rotating 3D cube with Three.js" />
                    <PromptPill prompt="Build a calculator app" />
                  </>
                )}
              </div>
              {/* Surprise Me button - picks a random prompt */}
              <button
                onClick={() => {
                  const defaultPrompts = [
                    "What's the weather on Mars right now?",
                    "Get stock price for PIZZA (it's definitely a ticker)",
                    "Open the calculator - I need to split a $47.83 bill 7 ways",
                    "Search for flights to Atlantis",
                    "Show me hotels near the North Pole for Christmas",
                    "I need to approve purchasing 1000 rubber ducks for the office",
                    "What's the weather like in Mordor?",
                    "Search for flights to Wakanda, business class",
                    "I need to approve a $50M budget for a pizza party",
                  ];
                  const a2uiPrompts = [
                    "Find restaurants that serve food from fictional countries",
                    "Show me places where I can eat like a hobbit",
                    "Book a table for 47 people, we're having a flash mob dinner",
                    "Find sushi places run by actual robots",
                    "Show me restaurants with secret menus",
                    "Find a place that serves breakfast at midnight",
                  ];
                  const openGenUIPrompts = [
                    "Build a pixel art editor with a color palette",
                    "Create a dashboard showing CPU, memory, and network stats",
                    "Make a mini piano keyboard that plays notes when clicked",
                    "Build a Pomodoro timer with start, pause, and reset",
                    "Create a color palette generator with hex codes",
                    "Build a markdown editor with live preview",
                  ];
                  const prompts =
                    activeAgent === "default"
                      ? defaultPrompts
                      : activeAgent === "a2ui"
                        ? a2uiPrompts
                        : openGenUIPrompts;
                  const randomPrompt =
                    prompts[Math.floor(Math.random() * prompts.length)];
                  sendMessage(randomPrompt);
                }}
                className="mt-4 px-4 py-2 bg-gradient-to-r from-[#9f8fef] to-[#7dd3c0] text-white rounded-full font-medium hover:opacity-90 transition-opacity flex items-center gap-2 mx-auto"
              >
                <span>🎲</span> Surprise Me
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default function Home() {
  // Active agent state - switches between "default" (Static+MCP), "a2ui", and "opengenui"
  const [activeAgent, setActiveAgent] = useState<
    "default" | "a2ui" | "opengenui"
  >("default");

  // Load state from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("activeAgent");
    if (saved && (saved === "default" || saved === "a2ui" || saved === "opengenui")) {
      setActiveAgent(saved as any);
    }
  }, []);

  // Save state to localStorage whenever it changes
  useEffect(() => {
    console.log("Agent switched to:", activeAgent);
    localStorage.setItem("activeAgent", activeAgent);
  }, [activeAgent]);

  // Responsive layout: sidebar on desktop, popup on mobile
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const clearPendingMessage = () => {};

  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      agent={activeAgent}
      showDevConsole={false}
    >
      <CopilotContextProvider>
        {isDesktop ? (
          // Desktop: Sidebar layout
          <>
            <PageContent
              activeAgent={activeAgent}
              setActiveAgent={setActiveAgent}
              onPillClick={(prompt, targetMode) => {
                if (targetMode !== activeAgent) {
                  setActiveAgent(targetMode);
                }
                // Small delay to ensure agent switch
                setTimeout(() => sendMessage(prompt), 50);
              }}
            />
            <CopilotSidebar
              defaultOpen={true}
              labels={{
                modalHeaderTitle: activeAgent === "opengenui" ? "Open Generative UI" : "Static + MCP Apps",
                chatInputPlaceholder: activeAgent === "opengenui" 
                  ? "Ask me to build any UI — charts, apps, dashboards, and more!"
                  : "Ask about weather, stocks, or try the interactive apps!",
              }}
            />
          </>
        ) : (
          // Mobile: Popup layout
          <>
            <PageContent
              activeAgent={activeAgent}
              setActiveAgent={setActiveAgent}
              onPillClick={(prompt, targetMode) => {
                if (targetMode !== activeAgent) {
                  setActiveAgent(targetMode);
                }
                // Small delay to ensure agent switch
                setTimeout(() => sendMessage(prompt), 50);
              }}
            />
            <CopilotPopup
              defaultOpen={false}
              labels={{
                modalHeaderTitle: activeAgent === "opengenui" ? "Open Generative UI" : "Static + MCP Apps",
                chatInputPlaceholder: activeAgent === "opengenui" 
                  ? "Ask me to build any UI — charts, apps, dashboards, and more!"
                  : "Ask about weather, stocks, or try the interactive apps!",
              }}
            />
          </>
        )}
      </CopilotContextProvider>
    </CopilotKitProvider>
  );
}
