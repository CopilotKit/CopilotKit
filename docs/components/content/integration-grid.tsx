import Link from "next/link";
import { AgentSpecMarkIcon } from "@/lib/icons/custom-icons";
import AdkIcon from "@/components/ui/icons/adk";
import Ag2Icon from "@/components/ui/icons/ag2";
import CrewaiIcon from "@/components/ui/icons/crewai";
import CopilotKitMarkIcon from "@/components/ui/icons/copilotkit-mark";
import LanggraphIcon from "@/components/ui/icons/langgraph";
import LlamaIndexIcon from "@/components/ui/icons/llama-index";
import MastraIcon from "@/components/ui/icons/mastra";
import AgnoIcon from "@/components/ui/icons/agno";
import PydanticAiIcon from "@/components/ui/icons/pydantic-ai";
import { MicrosoftIcon } from "@/components/ui/icons/microsoft";
import { AwsStrandsIcon } from "@/components/ui/icons/aws-strands";
import type { ComponentType } from "react";

export type IntegrationName =
  | "built-in-agent"
  | "langgraph"
  | "adk"
  | "microsoft-agent-framework"
  | "aws-strands"
  | "mastra"
  | "pydantic-ai"
  | "crewai-flows"
  | "agno"
  | "ag2"
  | "agent-spec"
  | "llamaindex";

interface Integration {
  name: IntegrationName;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}

const INTEGRATIONS: Integration[] = [
  {
    name: "built-in-agent",
    label: "Built-in Agent",
    description:
      "Use CopilotKit's built-in agent — no external framework required.",
    icon: CopilotKitMarkIcon,
  },
  {
    name: "langgraph",
    label: "LangGraph",
    description: "LangChain's framework for stateful agent workflows.",
    icon: LanggraphIcon,
  },
  {
    name: "adk",
    label: "ADK",
    description: "Google's Agent Development Kit for building AI agents.",
    icon: AdkIcon,
  },
  {
    name: "microsoft-agent-framework",
    label: "Microsoft Agent Framework",
    description: "Microsoft's framework for building AI agents.",
    icon: MicrosoftIcon,
  },
  {
    name: "aws-strands",
    label: "AWS Strands",
    description: "AWS SDK for building and orchestrating AI agents.",
    icon: AwsStrandsIcon,
  },
  {
    name: "mastra",
    label: "Mastra",
    description: "TypeScript framework for building AI agents.",
    icon: MastraIcon,
  },
  {
    name: "pydantic-ai",
    label: "Pydantic AI",
    description: "Type-safe Python framework for AI agents.",
    icon: PydanticAiIcon,
  },
  {
    name: "crewai-flows",
    label: "CrewAI Flows",
    description: "Orchestrate sequential AI agent workflows.",
    icon: CrewaiIcon,
  },
  {
    name: "agno",
    label: "Agno",
    description: "Lightweight framework for building AI agents.",
    icon: AgnoIcon,
  },
  {
    name: "ag2",
    label: "AG2",
    description: "The open-source multi-agent OS.",
    icon: Ag2Icon,
  },
  {
    name: "agent-spec",
    label: "Open Agent Spec",
    description: "Open standard for defining AI agent interfaces.",
    icon: AgentSpecMarkIcon,
  },
  {
    name: "llamaindex",
    label: "LlamaIndex",
    description: "Framework for building LLM-powered data applications.",
    icon: LlamaIndexIcon,
  },
];

interface IntegrationGridProps {
  path?: string;
  include?: IntegrationName[];
  exclude?: IntegrationName[];
}

export const IntegrationGrid = ({
  path = "",
  include,
  exclude,
}: IntegrationGridProps) => {
  const filtered = INTEGRATIONS.filter((integration) => {
    if (include && !include.includes(integration.name)) return false;
    if (exclude && exclude.includes(integration.name)) return false;
    return true;
  });

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-8 mt-6 mb-16 not-prose">
      {filtered.map(({ name, label, description, icon: Icon }) => (
        <Link
          key={name}
          href={`/${name}/${path}`}
          className="group flex items-start gap-4 no-underline"
        >
          <div className="shrink-0 mt-1">
            <Icon className="h-6 w-6 text-primary" />
          </div>
          <div>
            <div className="font-semibold text-foreground group-hover:text-primary transition-colors">
              {label} &rsaquo;
            </div>
            <div className="text-sm text-muted-foreground leading-relaxed mt-0.5">
              {description}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
};
