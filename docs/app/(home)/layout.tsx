import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import { baseOptions } from "../layout.config";
import { source } from "@/app/source";
import { customIcons } from "@/lib/icons/custom-icons";
import { Sparkle, Zap, Code } from "lucide-react"

const Icon = ({ icon }: { icon: ReactNode }) => {
  return <div className="text-primary w-6 h-6 flex pb-2 items-center justify-center">{icon}</div>;
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <DocsLayout
        tree={source.pageTree}
        sidebar={{
          tabs: [
            {
              url: "/",
              title: "Overview",
              icon: <Icon icon={<Sparkle className="w-5 h-5" />} />,
            },
            {
              url: "/direct-to-llm",
              title: "Direct to LLM",  
              icon: <Icon icon={<Zap className="w-5 h-5" />} />,
            },
            {
              url: "/coagents",
              title: "LangGraph",
              icon: <Icon icon={<customIcons.langchain className="w-5 h-5" />} />,
            },
            {
              url: "/mastra",
              title: "Mastra",
              icon: <Icon icon={<customIcons.mastra className="w-5 h-5" />} />,
            },
            {
              url: "/crewai-flows", 
              title: "CrewAI Flows",
              icon: <Icon icon={<customIcons.crewai className="w-5 h-5" />} />,
            },
            {
              url: "/crewai-crews",
              title: "CrewAI Crews",
              icon: <Icon icon={<customIcons.crewai className="w-5 h-5" />} />,
            },
            {
              url: "/llamaindex",
              title: "LlamaIndex",
              icon: <Icon icon={<customIcons.llamaindex className="w-5 h-5" />} />,
            },
            {
              url: "/agno",
              title: "Agno",
              icon: <Icon icon={<customIcons.agno className="w-5 h-5" />} />,
            },
            {
              url: "/ag2",
              title: "AG2",
              icon: <Icon icon={<customIcons.ag2 className="w-5 h-5" />} />,
            },
            {
              url: "/reference",
              title: "Reference",
              icon: <Icon icon={<Code className="w-5 h-5" />} />,
            },
          ],
        }}
        {...baseOptions}
      >
        {children}
      </DocsLayout>
    </>
  );
}
