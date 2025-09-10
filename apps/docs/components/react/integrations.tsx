import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { MastraIcon, LlamaIndexIcon, AG2Icon, AgnoIcon, PydanticAIIcon } from "@/lib/icons/custom-icons";
import { SiCrewai } from "@icons-pack/react-simple-icons";
import { SiLangchain } from "react-icons/si";
import { Brain } from "lucide-react";
import { RocketIcon } from "lucide-react";

interface Integration {
  title: string;
  description?: string;
  logo: React.ReactNode;
  bgGradient: string;
  href: string;
}

interface IntegrationCardProps {
  integration: Integration;
  className?: string;
}

const integrations: Integration[] = [
  {
    title: "Direct to LLM",
    description: "Use CopilotKit directly with your LLM of choice. No framework required.",
    logo: <RocketIcon className="w-8 h-8" />,
    bgGradient: "bg-gradient-to-b from-green-700 to-green-400 text-green-100",
    href: "/direct-to-llm",
  },
  {
    title: "LangGraph",
    description: "LangGraph is a framework for building and deploying AI agents.",
    logo: <SiLangchain className="w-8 h-8" />,
    bgGradient: "bg-gradient-to-b from-purple-700 to-purple-400 text-purple-100",
    href: "/coagents",
  },
  {
    title: "Mastra",
    description: "Mastra is a framework for building and deploying AI agents.",
    logo: <MastraIcon className="w-8 h-8" />,
    bgGradient: "bg-gradient-to-b from-black to-zinc-800 text-white",
    href: "/mastra",
  },
  {
    title: "CrewAI Crews",
    description: "CrewAI is a framework for building and deploying AI agents.",
    logo: <SiCrewai className="w-8 h-8" />,
    bgGradient: "bg-gradient-to-b from-[#FA694C] to-[#FE8A71] text-white",
    href: "/crewai-crews",
  },
  {
    title: "CrewAI Flows",
    description: "CrewAI is a framework for building and deploying AI agents.",
    logo: <SiCrewai className="w-8 h-8" />,
    bgGradient: "bg-gradient-to-b from-[#FA694C] to-[#FE8A71] text-white",
    href: "/crewai-flows",
  },
  {
    title: "Agno",
    description: "Agno is a framework for building and deploying AI agents.",
    logo: <AgnoIcon className="w-8 h-8" />,
    bgGradient: "bg-[#FF3C1A] text-white",
    href: "/agno",
  },
  {
    title: "LlamaIndex",
    description: "LlamaIndex is a framework for building and deploying AI agents.",
    logo: <LlamaIndexIcon className="w-8 h-8" />,
    bgGradient: "bg-gradient-to-b from-pink-500 via-purple-500 to-blue-400 text-pink-100",
    href: "/llamaindex",
  },
  {
    title: "Pydantic AI",
    description: "Pydantic AI is a framework for building and deploying AI agents.",
    logo: <PydanticAIIcon className="w-8 h-8 text-bold" />,
    bgGradient: "bg-[#ED2762] text-white",
    href: "/pydantic-ai",
  },
  {
    title: "AutoGen2",
    description: "AutoGen2 is a framework for building and deploying AI agents.",
    logo: <AG2Icon className="w-8 h-8 text-bold" />,
    bgGradient: "bg-gradient-to-b from-indigo-700 to-indigo-400 text-indigo-100",
    href: "/ag2",
  },
  // Add more integrations here
];

const IntegrationCard: React.FC<IntegrationCardProps> = ({
  integration,
  className,
}) => {
  const { title, logo, href } = integration;
  
  return (
    <Card className={cn(
      "group transition-all duration-200 hover:shadow-lg dark:hover:shadow-black/20",
      "bg-white dark:bg-zinc-900 border border-zinc-200/50 dark:border-zinc-800",
      "hover:border-zinc-300 dark:hover:border-zinc-700",
      "rounded-lg",
      "flex flex-col",
      className
    )}>
      <a href={href} className="block p-6 flex-1 flex flex-col no-underline">
        <CardHeader className="p-0">
          <CardTitle className="text-lg font-medium text-zinc-800 dark:text-zinc-200">
            {title}
          </CardTitle>
        </CardHeader>
        <div className="flex-1 flex items-center justify-center py-8">
          <div className="text-zinc-600 dark:text-zinc-400 group-hover:text-black dark:group-hover:text-white transition-colors duration-200">
            {logo}
          </div>
        </div>
      </a>
    </Card>
  );
};

interface IntegrationsGridProps {
  targetPage?: string;
  suppressDirectToLLM?: boolean;
}

const IntegrationsGrid: React.FC<IntegrationsGridProps> = ({ targetPage, suppressDirectToLLM = false }) => {
  const hasTargetPage = (integration: Integration, targetPage: string): boolean => {
    // Direct to LLM special cases
    if (integration.title === "Direct to LLM") {
      return targetPage === "generative-ui" || targetPage === "frontend-actions";
    }
    
    // AutoGen2 missing pages
    if (integration.title === "AutoGen2") {
      return targetPage !== "generative-ui" && targetPage !== "shared-state";
    }
    
    // Frameworks that don't have shared-state pages
    if (targetPage === "shared-state") {
      return !["LlamaIndex", "Mastra", "AutoGen2", "Agno"].includes(integration.title);
    }
    
    // All other frameworks have the standard pages
    return true;
  };

  const getHref = (integration: Integration) => {
    if (!targetPage) {
      return integration.href;
    }
    
    // Special cases where certain frameworks have pages in different locations
    if (integration.title === "Direct to LLM") {
      if (targetPage === "generative-ui") {
        return "/direct-to-llm/guides/generative-ui";
      }
      if (targetPage === "frontend-actions") {
        return "/direct-to-llm/guides/frontend-actions";
      }
    }
    
    // For other frameworks, append the target page
    return `${integration.href}/${targetPage}`;
  };

  let filteredIntegrations = integrations;
  
  // Filter out Direct to LLM if suppressed
  if (suppressDirectToLLM) {
    filteredIntegrations = filteredIntegrations.filter(integration => integration.title !== "Direct to LLM");
  }
  
  // Filter out integrations that don't have the target page
  if (targetPage) {
    filteredIntegrations = filteredIntegrations.filter(integration => hasTargetPage(integration, targetPage));
  }

  return (
    <div className="flex flex-row flex-wrap justify-center items-center gap-x-6 gap-y-6 my-8">
      {filteredIntegrations.map((integration, index) => (
        <a 
          key={index}
          href={getHref(integration)}
          className="flex flex-col items-center gap-3 text-center no-underline group"
        >
          <div className={`w-12 h-12 flex items-center justify-center rounded-2xl transition-all duration-200 group-hover:scale-105 ${integration.bgGradient}`}>
            {integration.logo}
          </div>
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 group-hover:text-black dark:group-hover:text-white transition-colors duration-200">
            {integration.title}
          </span>
        </a>
      ))}
    </div>
  );
};

export { IntegrationCard, IntegrationsGrid, integrations };
export type { IntegrationsGridProps };
