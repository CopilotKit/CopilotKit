"use client";

import { useEffect, useState } from "react";
import { Textarea } from "./ui/textarea";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { CornerDownLeftIcon } from "lucide-react";
import { useResearchContext } from "@/lib/research-provider";
import { motion } from "framer-motion";
import { useCoAgent } from "@copilotkit/react-core";
import { TextMessage, MessageRole } from "@copilotkit/runtime-client-gql";
import type { AgentState } from "../lib/types";
import { useModelSelectorContext } from "@/lib/model-selector-provider";

const MAX_INPUT_LENGTH = 250;

export function HomeView() {
  const { setResearchQuery, researchInput, setResearchInput } =
    useResearchContext();
  const { model } = useModelSelectorContext();
  const [isInputFocused, setIsInputFocused] = useState(false);
  const {
    run: runResearchAgent,
  } = useCoAgent<AgentState>({
    name: "ai_researcher",
    initialState: {
      model,
    },
  });

  const handleResearch = (query: string) => {
    setResearchQuery(query);
    runResearchAgent(() => {
      return new TextMessage({
        role: MessageRole.User,
        content: query,
      });
    });
  };

  const suggestions = [
    { label: "Electric cars sold in 2024 vs 2023", icon: "🚙" },
    { label: "Top 10 richest people in the world", icon: "💰" },
    { label: "Population of the World", icon: "🌍 " },
    { label: "Weather in Seattle VS New York", icon: "⛅️" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: -50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="h-screen w-full flex flex-col gap-y-2 justify-center items-center p-4 lg:p-0"
    >
      <h1 className="text-4xl font-extralight mb-6">
        What would you like to know?
      </h1>

      <div
        className={cn(
          "w-full bg-slate-100/50 border shadow-sm rounded-md transition-all",
          {
            "ring-1 ring-slate-300": isInputFocused,
          }
        )}
      >
        <Textarea
          placeholder="Ask anything..."
          className="bg-transparent p-4 resize-none focus-visible:ring-0 focus-visible:ring-offset-0 border-0 w-full"
          onFocus={() => setIsInputFocused(true)}
          onBlur={() => setIsInputFocused(false)}
          value={researchInput}
          onChange={(e) => setResearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleResearch(researchInput);
            }
          }}
          maxLength={MAX_INPUT_LENGTH}
        />
        <div className="text-xs p-4 flex items-center justify-between">
          <div
            className={cn("transition-all duration-300 mt-4 text-slate-500", {
              "opacity-0": !researchInput,
              "opacity-100": researchInput,
            })}
          >
            {researchInput.length} / {MAX_INPUT_LENGTH}
          </div>
          <Button
            size="sm"
            className={cn("rounded-full transition-all duration-300", {
              "opacity-0 pointer-events-none": !researchInput,
              "opacity-100": researchInput,
            })}
            onClick={() => handleResearch(researchInput)}
          >
            Research
            <CornerDownLeftIcon className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 w-full gap-2 text-sm">
        {suggestions.map((suggestion) => (
          <div
            key={suggestion.label}
            onClick={() => handleResearch(suggestion.label)}
            className="p-2 bg-slate-100/50 rounded-md border col-span-2 lg:col-span-1 flex cursor-pointer items-center space-x-2 hover:bg-slate-100 transition-all duration-300"
          >
            <span className="text-base">{suggestion.icon}</span>
            <span className="flex-1">{suggestion.label}</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
