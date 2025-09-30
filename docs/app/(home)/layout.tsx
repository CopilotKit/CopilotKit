import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import { baseOptions } from "../layout.config";
import { source } from "@/app/source";
import { TopNav } from "@/components/layout/top-nav";
import { SubdocsMenu } from "@/components/react/subdocs-menu";
import { 
  RocketIcon,
} from "lucide-react";
import { SiCrewai } from "@icons-pack/react-simple-icons";
import { SiLangchain } from "react-icons/si";
import {
  ADKIcon,
  AG2Icon,
  MastraIcon,
  AgnoIcon,
  LlamaIndexIcon,
  PydanticAIIcon,
} from "@/lib/icons/custom-icons";

// Integration options for the subdocs menu dropdown
const integrationOptions = [
  {
    title: "Select an Integration",
    options: [
      {
        title: "Direct to LLM",
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
        bgGradient: "from-blue-500 to-purple-600",
      },
      {
        title: "LangGraph",
        url: "/langgraph",
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
        bgGradient: "from-orange-500 to-red-600",
      },
      {
        title: "Mastra",
        url: "/mastra",
        icon: <MastraIcon className="w-4 h-4 text-bold" />,
        bgGradient: "from-green-500 to-teal-600",
      },
      {
        title: "CrewAI Crews",
        url: "/crewai-crews",
        icon: <SiCrewai className="w-4 h-4 text-bold" />,
        bgGradient: "from-purple-500 to-pink-600",
      },
      {
        title: "CrewAI Flows",
        url: "/crewai-flows",
        icon: <SiCrewai className="w-4 h-4 text-bold" />,
        bgGradient: "from-indigo-500 to-purple-600",
      },
      {
        title: "PydanticAI",
        url: "/pydantic-ai",
        icon: <PydanticAIIcon className="w-4 h-4 text-bold" />,
        bgGradient: "from-yellow-500 to-orange-600",
      },
      {
        title: "ADK",
        url: "/adk",
        icon: <ADKIcon className="w-4 h-4 text-bold" />,
        bgGradient: "from-cyan-500 to-blue-600",
      },
      {
        title: "Agno",
        url: "/agno",
        icon: <AgnoIcon className="w-4 h-4 text-bold" />,
        bgGradient: "from-emerald-500 to-green-600",
      },
      {
        title: "LlamaIndex",
        url: "/llamaindex",
        icon: <LlamaIndexIcon className="w-4 h-4 text-bold" />,
        bgGradient: "from-rose-500 to-pink-600",
      },
      {
        title: "AutoGen2",
        url: "/ag2",
        icon: <AG2Icon className="w-4 h-4 text-bold" />,
        bgGradient: "from-violet-500 to-purple-600",
      },
    ],
  },
];

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      searchToggle={{ enabled: true }}
      sidebar={{
        tabs: false,
        banner: <SubdocsMenu options={integrationOptions} />,
      }}
      {...baseOptions}
    >
      <TopNav />
      {children}
    </DocsLayout>
  );
}
