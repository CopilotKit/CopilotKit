"use client";

import { A2UIPage } from "./components/A2UIPage";
import { A2UICard } from "./components/protocol-cards/A2UICard";
import { PromptPill } from "./components/PromptPill";
import { useSendMessage } from "./hooks/useSendMessage";
import "@copilotkitnext/react/styles.css";

function PageContent() {
  const { sendMessage } = useSendMessage();

  const a2uiPrompts = [
    "Create a registration form with name, email, and a dropdown to pick a subscription plan (Free, Pro, Enterprise)",
    "Find restaurants that serve food from fictional countries",
    "Show me places where I can eat like a hobbit",
    "Book a table for 47 people, we're having a flash mob dinner",
    "Find sushi places run by actual robots",
    "Show me restaurants with secret menus",
    "Find a place that serves breakfast at midnight",
  ];

  return (
    <>
      <div className="abstract-bg">
        <div className="blob-3" />
      </div>

      <div className="flex min-h-screen">
        <div className="relative z-10 flex-1 p-4 md:p-8 overflow-auto">
          <div className="max-w-3xl mx-auto">
            <header className="text-center mb-8">
              <div className="flex justify-center items-center gap-4 mb-4">
                <h1 className="text-2xl md:text-4xl font-bold">
                  <span className="text-gradient">A2UI</span> Playground
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
                Declarative generative UI with CopilotKit: the agent composes
                A2UI JSON and the client renders it dynamically.
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

            <div className="max-w-xl mx-auto mb-8">
              <A2UICard
                isActive={true}
                onPromptClick={(prompt) => sendMessage(prompt)}
              />
            </div>

            <div className="mt-8 text-center">
              <p className="text-[var(--color-text-tertiary)] mb-4">
                Try these prompts in the chat:
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <PromptPill prompt="Find Italian restaurants nearby" />
                <PromptPill prompt="Show me Chinese food options" />
                <PromptPill prompt="Book a table for 4" />
              </div>
              <button
                type="button"
                onClick={() => {
                  const randomPrompt =
                    a2uiPrompts[Math.floor(Math.random() * a2uiPrompts.length)];
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
  return (
    <A2UIPage>
      <PageContent />
    </A2UIPage>
  );
}
