import { DocsLayout } from "fumadocs-ui/layout";
import type { ReactNode } from "react";
import { baseOptions } from "../layout.config";
import { source } from "@/app/source";
import { SubdocsMenu } from "@/components/react/subdocs-menu";
import { TerminalIcon, RocketIcon, ZapIcon, CircleArrowOutUpRight } from "lucide-react";
import { TopBar } from "@/components/layout/top-bar";

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
                  title: "Copilots",
                  description: "Documentation for building Copilots",
                  url: "/",
                  icon: <RocketIcon className="w-4 h-4" />,
                  bgGradient:
                    "bg-gradient-to-b from-indigo-700 to-indigo-400 text-indigo-100",
                  selectedBorder: "ring-indigo-500/70",
                },
                {
                  title: "CoAgents (LangGraph)",
                  description: "CoAgents (LangGraph)",
                  url: "/coagents",
                  icon: <ZapIcon className="w-4 h-4" />,
                  bgGradient:
                    "bg-gradient-to-b from-rose-700 to-rose-400 text-rose-100",
                  selectedBorder: "ring-rose-500/70",
                },
                {
                  title: "API Reference",
                  description: "API Reference",
                  url: "/reference",
                  icon: <TerminalIcon className="w-4 h-4" />,
                  bgGradient:
                    "bg-gradient-to-b from-teal-700 to-teal-400 text-teal-100",
                  selectedBorder: "ring-teal-500/70",
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
