"use client";

import { useRouter } from "next/navigation";
import { ChangeEvent } from "react";
import ChevronDownIcon from "@/components/ui/icons/chevron";

export function QuickstartDropdown() {
  const router = useRouter();

  const options = [
    { label: "Direct to LLM", url: "/direct-to-llm/guides/quickstart" },
    { label: "LangGraph", url: "/langgraph/quickstart" },
    {
      label: "Microsoft Agent Framework",
      url: "/microsoft-agent-framework/quickstart",
    },
    { label: "Mastra", url: "/mastra/quickstart" },
    { label: "LlamaIndex", url: "/llamaindex/quickstart" },
    { label: "Agno", url: "/agno/quickstart" },
    { label: "CrewAI Flows", url: "/crewai-flows/quickstart/crewai" },
    { label: "CrewAI Crews", url: "/crewai-crews/quickstart/crewai" },
    { label: "AG2", url: "/ag2/quickstart" },
    { label: "Pydantic AI", url: "/pydantic-ai/quickstart" },
    { label: "ADK", url: "/adk/quickstart" },
    { label: "A2A", url: "/a2a/quickstart" },
  ];

  const handleSelectChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const selectedUrl = event.target.value;
    if (selectedUrl) {
      router.push(selectedUrl);
    }
  };

  return (
    <div className="relative w-full">
      <select
        onChange={handleSelectChange}
        className="font-spline w-full cursor-pointer appearance-none rounded-lg bg-[#0105070D] p-3 pr-10 pl-4 text-sm font-medium text-[#010507] transition-all duration-100 dark:bg-[#FFFFFF1A] dark:text-white"
        defaultValue=""
      >
        <option value="" disabled>
          CHOOSE INTEGRATION
        </option>
        {options.map((option) => (
          <option key={option.url} value={option.url}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-[#010507] dark:text-white" />
    </div>
  );
}
