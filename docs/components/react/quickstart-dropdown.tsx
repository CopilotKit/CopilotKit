"use client";

import { useRouter } from "next/navigation";
import { ChangeEvent } from "react";

export function QuickstartDropdown() {
  const router = useRouter();

  const options = [
    { label: "LLM", url: "/quickstart" },
    { label: "AG2", url: "/ag2/quickstart" },
    { label: "LangGraph", url: "/coagents/quickstart/langgraph" },
    { label: "CrewAI Flows", url: "/crewai-flows/quickstart/crewai" },
    { label: "CrewAI Crews", url: "/crewai-crews/quickstart/crewai" },
    { label: "Mastra", url: "/mastra/quickstart" },
  ];

  const handleSelectChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const selectedUrl = event.target.value;
    if (selectedUrl) {
      router.push(selectedUrl);
    }
  };

  return (
    <select
      onChange={handleSelectChange}
      className="text-indigo-800 dark:text-indigo-300 ring-1 ring-indigo-200 dark:ring-indigo-900 text-sm items-center bg-gradient-to-r from-indigo-200/50 to-purple-200/80 dark:from-indigo-900/40 dark:to-purple-900/50 p-3 px-4 transition-all duration-100 hover:ring-2 hover:ring-indigo-400 hover:dark:text-indigo-200 rounded-lg no-underline font-semibold cursor-pointer"
      defaultValue="" // Set a default empty value
    >
      <option value="" disabled>
        Choose Agent
      </option>
      {options.map((option) => (
        <option key={option.url} value={option.url}>
          {option.label}
        </option>
      ))}
    </select>
  );
} 