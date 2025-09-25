"use client";

import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import { CopilotKitCSSProperties, CopilotSidebar, useCopilotChatSuggestions } from "@copilotkit/react-ui";
import { useState } from "react";

export default function CopilotKitPage() {
  const [themeColor, setThemeColor] = useState("#6366f1");

  // 🪁 Frontend Actions: https://docs.copilotkit.ai/guides/frontend-actions
  useCopilotAction({
    name: "setThemeColor",
    parameters: [{
      name: "themeColor",
      description: "The theme color to set. Make sure to pick nice colors.",
      required: true, 
    }],
    handler({ themeColor }) {
      setThemeColor(themeColor);
    },
  });

  return (
    <main style={{ "--copilot-kit-primary-color": themeColor } as CopilotKitCSSProperties}>
      <YourMainContent themeColor={themeColor} />
      <CopilotSidebar
        clickOutsideToClose={false}
        defaultOpen={true}
        labels={{
          title: "Popup Assistant",
          initial: "👋 Hi, there! You're chatting with an LLM.\n\n Since you scaffolded me with **CopilotKit**, you can ask me to do some cool stuff. \n\nFor example, you can ask me to:\n- Set the theme to orange\n- Write a proverb about AI\n- Generate a cool gradient card\n\nThen just watch as I perform tasks around the entire application!"
        }}
      />
    </main>
  );
}

function YourMainContent({ themeColor }: { themeColor: string }) {
  const [proverbs, setProverbs] = useState<string[]>(['Success is the sum of small efforts, repeated day in and day out.']);

  // 🪁 Copilot Suggestions: https://docs.copilotkit.ai/guides/copilot-suggestions
  useCopilotChatSuggestions({
    maxSuggestions: 3,
    minSuggestions: 3,
    instructions: "Give the user 3 options: 'Change theme color' (choose a random hexadecimal color), 'Write a proverb about {topic}' (choose a random topic) or 'Generate a gradient card between {color1} and {color2}' (choose random hexadecimal colors)",
  })

  // 🪁 Frontend Readables: https://docs.copilotkit.ai/guides/connect-your-data/frontend
  useCopilotReadable({
    description: "The current list of proverbs",
    value: proverbs,
  })

  // 🪁 Frontend Tools: https://docs.copilotkit.ai/guides/frontend-actions
  useCopilotAction({
    name: "addProverb",
    parameters: [{
      name: "proverb",
      description: "The proverb to add. Make it witty, short and concise.",
      required: true,
    }],
    handler: ({ proverb }) => {
      setProverbs([...proverbs, proverb]);
    },
  });

  //🪁 Generative UI: https://docs.copilotkit.ai/guides/generative-ui
  useCopilotAction({
    name: "generateGradientCard",
    description: "Generate a card with a card with a background gradient between two colors.",
    parameters: [
      { name: "color1", type: "string", required: true },
      { name: "color2", type: "string", required: true },
    ],
    render: ({ args }) => {
      return (
        <div 
          style={{ background: `linear-gradient(to right, ${args.color1}, ${args.color2})`}} 
          className="p-10 my-4 rounded-xl flex flex-col justify-between flex-row"
        >
          <p className="text-white/50">{args.color1}</p>
          <p className="text-white/60">{args.color2}</p>
        </div>
      );
    },
  });

  return (
    <div
      style={{ backgroundColor: themeColor }}
      className="h-screen w-screen flex justify-center items-center flex-col transition-colors duration-300"
    >
      <div className="bg-white/20 backdrop-blur-md p-8 rounded-2xl shadow-xl max-w-2xl w-full">
        <h1 className="text-4xl font-bold text-white mb-2 text-center">Proverbs</h1>
        <p className="text-gray-200 text-center italic mb-6">This is a demonstrative page, but it could be anything you want! 🪁</p>
        <hr className="border-white/20 my-6" />
        <div className="flex flex-col gap-3">
          {proverbs.map((proverb, index) => (
            <div 
              key={index} 
              className="bg-white/15 p-4 rounded-xl text-white relative group hover:bg-white/20 transition-all"
            >
              <p className="pr-8">{proverb}</p>
              <button 
                onClick={() => setProverbs(proverbs.filter((_, i) => i !== index))}
                className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 transition-opacity 
                  bg-red-500 hover:bg-red-600 text-white rounded-full h-6 w-6 flex items-center justify-center"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        {proverbs.length === 0 && <p className="text-center text-white/80 italic my-8">
          No proverbs yet. Ask the assistant to add some!
        </p>}
      </div>
    </div>
  );
}
