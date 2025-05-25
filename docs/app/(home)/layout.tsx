import { DocsLayout } from "fumadocs-ui/layout";
import type { ReactNode } from "react";
import { baseOptions } from "../layout.config";
import { source } from "@/app/source";
import { SubdocsMenu } from "@/components/react/subdocs-menu";
import { TerminalIcon, RocketIcon, Bot, UserCog } from "lucide-react";
import { SiCrewai } from "@icons-pack/react-simple-icons";
import { TopBar } from "@/components/layout/top-bar";
import { SiLangchain } from "react-icons/si";
import { AG2Icon, MastraIcon } from "@/lib/icons/custom-icons";
import { LuPlane } from "react-icons/lu";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <TopBar />
      <DocsLayout
        tree={source.pageTree}
        {...baseOptions}
        sidebar={{
          hideSearch: true,
          banner: (
            <SubdocsMenu
              options={[
                {
                  title: "The Standard Agent",
                  description: "Documentation for building Copilots",
                  url: "/",
                  icon: <Bot className="w-4 h-4" />,
                  bgGradient:
                    "bg-gradient-to-b from-indigo-700 to-indigo-400 text-indigo-100",
                  selectedStyle: "ring-indigo-500/70 ring-2 rounded-sm",
                },

                {
                  title: "CoAgents (LangGraph, CrewAI, Mastra, AG2)",
                  categories: [
                    {
                      name: "Getting Started",
                      options: [
                        {
                          title: "What are CoAgents?",
                          description:
                            "CoAgents allow you to build AI-powered agents that can execute tasks and make decisions on your behalf.",
                          url: "/coagents-home",
                          icon: <UserCog className="w-4 h-4" />,
                          bgGradient:
                            "bg-gradient-to-b from-yellow-500 to-yellow-300 text-yellow-900",
                          selectedStyle: "ring-yellow-500/70 ring-2 rounded-sm",
                        },
                      ]
                    },
                    {
                      name: "Frameworks",
                      options: [
                        {
                          title: "CoAgents (LangGraph)",
                          description: "Documentation for CoAgents with LangGraph",
                          url: "/langgraph",
                          icon: <SiLangchain className="w-4 h-4 text-bold" />,
                          bgGradient:
                            "bg-gradient-to-b from-purple-700 to-purple-400 text-purple-100",
                          selectedStyle: "ring-purple-500/70 ring-2 rounded-sm",
                        },
                        {
                          title: "CoAgents (CrewAI Flows)",
                          description:
                            "Documentation for CoAgents with CrewAI Flows",
                          url: "/crewai-flows",
                          icon: <SiCrewai className="w-4 h-4 text-bold" />,
                          bgGradient:
                            "bg-gradient-to-b from-[#FA694C] to-[#FE8A71] text-white",
                          selectedStyle: "ring-[#FA694C]/70 ring-2 rounded-sm",
                        },
                        {
                          title: "CoAgents (CrewAI Crews)",
                          description:
                            "Documentation for CoAgents with CrewAI Crews",
                          url: "/crewai-crews",
                          icon: <SiCrewai className="w-4 h-4 text-bold" />,
                          bgGradient:
                            "bg-gradient-to-b from-[#FA694C] to-[#FE8A71] text-white",
                          selectedStyle: "ring-[#FA694C]/70 ring-2 rounded-sm",
                        },
                        {
                          title: "CoAgents (Mastra)",
                          description: "Documentation for CoAgents with Mastra",
                          url: "/mastra",
                          icon: <MastraIcon className="w-4 h-4 text-bold" />,
                          bgGradient:
                            "bg-gradient-to-b from-black to-zinc-800 text-white",
                          selectedStyle: "ring-zinc-800 dark:ring-white ring-2 rounded-sm",
                        },
                        {
                          title: "CoAgents (AG2)",
                          description: "Documentation for CoAgents with AG2",
                          url: "/ag2",
                          icon: <AG2Icon className="w-4 h-4 text-bold" />,
                          bgGradient:
                            "bg-gradient-to-b from-indigo-700 to-indigo-400 text-indigo-100",
                          selectedStyle: "ring-indigo-500/70 ring-2 rounded-sm",
                        },
                      ]
                    },
                    {
                      name: "Examples",
                      options: [
                        {
                          title: "Sample Projects",
                          description: "Example CoAgent implementations",
                          url: "/examples",
                          icon: <LuPlane className="w-4 h-4" />,
                          bgGradient:
                            "bg-gradient-to-b from-blue-700 to-blue-400 text-blue-100",
                          selectedStyle: "ring-blue-500/70 ring-2 rounded-sm",
                        },
                      ]
                    }
                  ],
                },
                {
                  title: "API Reference",
                  description: "API Reference",
                  url: "/reference",
                  icon: <TerminalIcon className="w-4 h-4" />,
                  bgGradient:
                    "bg-gradient-to-b from-teal-700 to-teal-400 text-teal-100",
                  selectedStyle: "ring-teal-500/70 ring-2 rounded-sm",
                },

                // {
                //   title: "Chat with our docs",
                //   description: "Chat with our docs",
                //   url: "https://entelligence.ai/CopilotKit&CopilotKit",
                //   icon: <CircleArrowOutUpRight className="w-4 h-4" />,
                //   bgGradient:
                //     "bg-gradient-to-b from-purple-700 to-purple-400 text-purple-100",
                //   selectedBorder: "ring-teal-500/70",
                // },
              ]}
            />
          ),
        }}
      >
        {children}
      </DocsLayout>
    </>
  );
}
