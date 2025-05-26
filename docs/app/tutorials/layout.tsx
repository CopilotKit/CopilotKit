import { DocsLayout } from "fumadocs-ui/layout";
import type { ReactNode } from "react";
import { baseOptions } from "../layout.config";
import { source } from "@/app/source";
import { SubdocsMenu } from "@/components/react/subdocs-menu";
import { TerminalIcon, Bot, UserCog } from "lucide-react";
import { SiCrewai } from "@icons-pack/react-simple-icons";
import { TopBar } from "@/components/layout/top-bar";
import { SiLangchain } from "react-icons/si";
import { AG2Icon, MastraIcon } from "@/lib/icons/custom-icons";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "CopilotKit Tutorials",
  description: "Step-by-step tutorials for building AI agents with different frameworks",
};

export default function TutorialsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <TopBar />
      <div className="pt-0"> {/* Remove extra padding at the top */}
        <DocsLayout
          tree={source.pageTree}
          {...baseOptions}
          sidebar={{
            hideSearch: true,
            banner: (
              <SubdocsMenu
                options={[
                  {
                    title: "Tutorials",
                    categories: [
                      {
                        name: "The Standard Agent",
                        options: [
                          {
                            title: "Getting Started",
                            description: "Learn how to build your first Copilot",
                            url: "/tutorials/standard-agent/getting-started",
                            icon: <Bot className="w-4 h-4" />,
                            bgGradient:
                              "bg-gradient-to-b from-indigo-700 to-indigo-400 text-indigo-100",
                            selectedStyle: "ring-indigo-500/70 ring-2 rounded-sm",
                          },
                        ]
                      },
                      {
                        name: "LangGraph",
                        options: [
                          {
                            title: "Basic Tutorial",
                            description: "Build a simple LangGraph agent",
                            url: "/tutorials/langgraph/basic",
                            icon: <SiLangchain className="w-4 h-4 text-bold" />,
                            bgGradient:
                              "bg-gradient-to-b from-purple-700 to-purple-400 text-purple-100",
                            selectedStyle: "ring-purple-500/70 ring-2 rounded-sm",
                          },
                        ]
                      },
                      {
                        name: "CrewAI",
                        options: [
                          {
                            title: "Flows Tutorial",
                            description: "Learn CrewAI Flows",
                            url: "/tutorials/crewai/flows",
                            icon: <SiCrewai className="w-4 h-4 text-bold" />,
                            bgGradient:
                              "bg-gradient-to-b from-[#FA694C] to-[#FE8A71] text-white",
                            selectedStyle: "ring-[#FA694C]/70 ring-2 rounded-sm",
                          },
                          {
                            title: "Crews Tutorial",
                            description: "Learn CrewAI Crews",
                            url: "/tutorials/crewai/crews",
                            icon: <SiCrewai className="w-4 h-4 text-bold" />,
                            bgGradient:
                              "bg-gradient-to-b from-[#FA694C] to-[#FE8A71] text-white",
                            selectedStyle: "ring-[#FA694C]/70 ring-2 rounded-sm",
                          },
                        ]
                      },
                      {
                        name: "Mastra",
                        options: [
                          {
                            title: "Basic Tutorial",
                            description: "Learn Mastra basics",
                            url: "/tutorials/mastra/basic",
                            icon: <MastraIcon className="w-4 h-4 text-bold" />,
                            bgGradient:
                              "bg-gradient-to-b from-black to-zinc-800 text-white",
                            selectedStyle: "ring-zinc-800 dark:ring-white ring-2 rounded-sm",
                          },
                        ]
                      },
                      {
                        name: "AG2",
                        options: [
                          {
                            title: "Basic Tutorial",
                            description: "Learn AG2 basics",
                            url: "/tutorials/ag2/basic",
                            icon: <AG2Icon className="w-4 h-4 text-bold" />,
                            bgGradient:
                              "bg-gradient-to-b from-indigo-700 to-indigo-400 text-indigo-100",
                            selectedStyle: "ring-indigo-500/70 ring-2 rounded-sm",
                          },
                        ]
                      }
                    ],
                  },
                ]}
              />
            ),
          }}
        >
          {children}
        </DocsLayout>
      </div>
    </>
  );
}
