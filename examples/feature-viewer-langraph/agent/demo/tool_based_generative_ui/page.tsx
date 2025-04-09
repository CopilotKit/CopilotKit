"use client";
import { CopilotKit, useCopilotAction } from "@copilotkit/react-core";
import { CopilotKitCSSProperties, CopilotSidebar } from "@copilotkit/react-ui";
import { useState, useEffect } from "react";
import "@copilotkit/react-ui/styles.css";
import "./style.css";

export default function AgenticChat() {
  return (
    <CopilotKit
      publicApiKey={process.env.NEXT_PUBLIC_COPILOT_CLOUD_API_KEY}
      showDevConsole={false}
      agent="tool_based_generative_ui"
    >
      <div
        className="min-h-screen w-full flex items-center justify-center page-background"
        style={
          {
            "--copilot-kit-primary-color": "#222",
            "--copilot-kit-separator-color": "#CCC",
          } as CopilotKitCSSProperties
        }
      >
        <Haiku />
        <CopilotSidebar
          defaultOpen={true}
          labels={{
            title: "Haiku Generator",
            initial: "I'm a haiku generator 👋. How can I help you?",
          }}
          clickOutsideToClose={false}
        />
      </div>
    </CopilotKit>
  );
}

function Haiku() {
  const [haiku, setHaiku] = useState<{
    japanese: string[];
    english: string[];
  }>({
    japanese: ["仮の句よ", "まっさらながら", "花を呼ぶ"],
    english: [
      "A placeholder verse—",
      "even in a blank canvas,",
      "it beckons flowers.",
    ],
  });
  const [isJustApplied, setIsJustApplied] = useState(false);

  useCopilotAction({
    name: "generate_haiku",
    parameters: [
      {
        name: "japanese",
        type: "string[]",
      },
      {
        name: "english",
        type: "string[]",
      },
    ],
    followUp: false,
    handler: async () => {
      return "Haiku generated.";
    },
    render: ({ args: generatedHaiku, result, status }) => {
      const [isAppliedLocally, setIsAppliedLocally] = useState(false);
      if (
        !generatedHaiku ||
        !generatedHaiku.japanese ||
        !generatedHaiku.japanese.length
      ) {
        return <></>;
      }

      return (
        <div className="text-left rounded-md p-4 mt-4 mb-4 flex flex-col bg-gray-100">
          <div
            className={
              status === "complete" ? "border-b border-gray-300 mb-4" : ""
            }
          >
            {generatedHaiku?.japanese?.map((line, index) => (
              <div className="flex items-center gap-3 mb-2 pb-2" key={index}>
                <p className="text-lg font-bold">{line}</p>
                <p className="text-sm font-light">
                  {generatedHaiku?.english?.[index]}
                </p>
              </div>
            ))}
          </div>
          {status === "complete" && (
            <button
              onClick={() => {
                setHaiku(generatedHaiku);
                setIsAppliedLocally(true);
                setIsJustApplied(true);
                setTimeout(() => setIsJustApplied(false), 600);
              }}
              className="ml-auto px-3 py-1 bg-white text-black text-sm rounded cursor-pointer font-sm border "
            >
              {isAppliedLocally ? "Applied ✓" : "Apply"}
            </button>
          )}
        </div>
      );
    },
  });
  return (
    <>
      <div className={`haiku-card animated-fade-in ${isJustApplied ? 'applied-flash' : ''}`}>
        {haiku?.japanese.map((line, index) => (
          <div 
            className="flex items-start gap-4 mb-4 haiku-line"
            key={index}
            style={{ animationDelay: `${index * 0.1}s` }}
          >
            <p className="text-4xl font-bold text-gray-600 w-auto">{line}</p>
            <p className="text-base font-light text-gray-500 w-auto">{haiku?.english?.[index]}</p>
          </div>
        ))}
      </div>
    </>
  );
}
