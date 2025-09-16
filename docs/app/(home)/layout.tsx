import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import { baseOptions } from "../layout.config";
import { source } from "@/app/source";
import { SubdocsMenu } from "@/components/react/subdocs-menu";
import { TopNav } from "@/components/layout/top-nav";
import { TerminalIcon, RocketIcon, CloudIcon } from "lucide-react";
import { SiCrewai } from "@icons-pack/react-simple-icons";
import { SiLangchain } from "react-icons/si";
import {
  AG2Icon,
  MastraIcon,
  AgnoIcon,
  LlamaIndexIcon,
  PydanticAIIcon,
} from "@/lib/icons/custom-icons";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      searchToggle={{ enabled: false }}
      sidebar={{
        tabs: false,
        banner: (
          <SubdocsMenu
            options={[
              {
                type: "separator",
              },
              {
                title: "Select an integration...",
                options: [
                  {
                    title: "Direct to LLM",
                    description: "Get started with CopilotKit quickly",
                    url: "/direct-to-llm",
                    icon: (
                      <RocketIcon
                        className="w-4 h-4"
                        style={{
                          fontSize: "16px",
                          width: "16px",
                          height: "16px",
                        }}
                      />
                    ),
                    bgGradient:
                      "bg-gradient-to-b from-green-700 to-green-400 text-green-100",
                    selectedStyle: "ring-green-500/70 ring-2 rounded-sm",
                  },
                  {
                    title: "LangGraph",
                    description: "Documentation for CoAgents with LangGraph",
                    url: "/coagents",
                    icon: (
                      <SiLangchain
                        className="w-4 h-4"
                        style={{
                          fontSize: "16px",
                          width: "16px",
                          height: "16px",
                        }}
                      />
                    ),
                    bgGradient:
                      "bg-gradient-to-b from-purple-700 to-purple-400 text-purple-100",
                    selectedStyle: "ring-purple-500/70 ring-2 rounded-sm",
                  },
                  {
                    title: "Mastra",
                    description: "Documentation for CoAgents with Mastra",
                    url: "/mastra",
                    icon: <MastraIcon className="w-4 h-4 text-bold" />,
                    bgGradient:
                      "bg-gradient-to-b from-black to-zinc-800 text-white",
                    selectedStyle:
                      "ring-zinc-800 dark:ring-white ring-2 rounded-sm",
                  },
                  {
                    title: "CrewAI Flows",
                    description:
                      "Documentation for CoAgents with CrewAI Flows",
                    url: "/crewai-flows",
                    icon: <SiCrewai className="w-4 h-4 text-bold" />,
                    bgGradient:
                      "bg-gradient-to-b from-[#FA694C] to-[#FE8A71] text-white",
                    selectedStyle: "ring-[#FA694C]/70 ring-2 rounded-sm",
                  },
                  {
                    title: "CrewAI Crews",
                    description:
                      "Documentation for CoAgents with CrewAI Crews",
                    url: "/crewai-crews",
                    icon: <SiCrewai className="w-4 h-4 text-bold" />,
                    bgGradient:
                      "bg-gradient-to-b from-[#FA694C] to-[#FE8A71] text-white",
                    selectedStyle: "ring-[#FA694C]/70 ring-2 rounded-sm",
                  },
                  {
                    title: "Pydantic AI",
                    description:
                      "Documentation for CoAgents with Pydantic AI",
                    url: "/pydantic-ai",
                    icon: <PydanticAIIcon className="w-4 h-4 text-bold" />,
                    bgGradient: "bg-black text-white",
                    selectedStyle: "ring-gray-500 ring-2 rounded-sm",
                  },
                  {
                    title: "Agno",
                    description: "Documentation for CoAgents with Agno",
                    url: "/agno",
                    icon: <AgnoIcon className="w-4 h-4 text-bold" />,
                    bgGradient: "bg-[#FF3C1A] text-white",
                    selectedStyle: "ring-[#FF3C1A] ring-2 rounded-sm",
                  },
                  {
                    title: "LlamaIndex",
                    description: "Documentation for CoAgents with LlamaIndex",
                    url: "/llamaindex",
                    icon: <LlamaIndexIcon className="w-4 h-4 text-bold" />,
                    bgGradient:
                      "bg-gradient-to-b from-pink-500 via-purple-500 to-blue-400 text-pink-100",
                    selectedStyle: "ring-pink-500/70 ring-2 rounded-sm",
                  },
                  {
                    title: "AutoGen2",
                    description: "Documentation for CoAgents with AG2",
                    url: "/ag2",
                    icon: <AG2Icon className="w-4 h-4 text-bold" />,
                    bgGradient:
                      "bg-gradient-to-b from-indigo-700 to-indigo-400 text-indigo-100",
                    selectedStyle: "ring-indigo-500/70 ring-2 rounded-sm",
                  },
                ],
              },
            ]}
          />
        ),
      }}
      {...baseOptions}
    >
      <TopNav />
      {children}
    </DocsLayout>
  );
}
