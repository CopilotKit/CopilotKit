"use client";
import { useCopilotAction } from "@copilotkit/react-core";
import { CopilotKitCSSProperties, CopilotSidebar } from "@copilotkit/react-ui";
import { useState } from "react";

export default function AgenticChat() {
  return (
    <div
      className="min-h-screen w-full flex items-center justify-center"
      style={
        {
          "--copilot-kit-primary-color": "#222",
          "--copilot-kit-separator-color": "#AAA",
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

  useCopilotAction({
    name: "generate_haiku",
    available: "frontend",
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
    render: ({ args: generatedHaiku, result, status }) => {
      if (
        !generatedHaiku ||
        !generatedHaiku.japanese ||
        !generatedHaiku.japanese.length
      ) {
        return <></>;
      }

      const isCurrentHaiku =
        haiku.japanese.join(" ") === generatedHaiku.japanese.join(" ");

      return (
        <div className="text-left border rounded-md p-4 mt-4 mb-4 flex flex-col">
          <div
            className={
              status === "complete" ? "border-b border-black mb-4" : ""
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
          {status === "complete" && !isCurrentHaiku && (
            <button
              onClick={() => {
                setHaiku(generatedHaiku);
              }}
              className="ml-auto px-3 py-1 bg-black text-white text-sm rounded hover:bg-gray-800 transition-colors cursor-pointer font-sm"
            >
              Apply
            </button>
          )}
          {status === "complete" && isCurrentHaiku && (
            <button className="ml-auto px-3 py-1 bg-white text-black text-sm rounded border border-black hover:bg-gray-100 transition-colors cursor-not-allowed font-sm">
              Applied ✔️
            </button>
          )}
        </div>
      );
    },
  });
  return (
    <>
      <div className="text-left">
        {haiku?.japanese.map((line, index) => (
          <div className="flex items-center gap-6 mb-2" key={index}>
            <p className="text-4xl font-bold text-gray-500">{line}</p>
            <p className="text-base font-light">{haiku?.english?.[index]}</p>
          </div>
        ))}
      </div>
    </>
  );
}
