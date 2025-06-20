import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { MastraIcon, LlamaIndexIcon, AG2Icon, AgnoIcon } from "@/lib/icons/custom-icons";
import { SiCrewai } from "@icons-pack/react-simple-icons";
import { SiLangchain } from "react-icons/si";
import { Brain } from "lucide-react";

interface Integration {
  title: string;
  description?: string;
  logo: React.ReactNode;
  href: string;
}

interface IntegrationCardProps {
  integration: Integration;
  className?: string;
}

const integrations: Integration[] = [
  {
    title: "LangGraph",
    description: "LangGraph is a framework for building and deploying AI agents.",
    logo: <SiLangchain className="w-32 h-32 bg-indigo-500 text-white p-4 rounded-3xl" />,
    href: "/coagents",
  },
  {
    title: "Mastra",
    description: "Mastra is a framework for building and deploying AI agents.",
    logo: <MastraIcon className="w-32 stroke-black h-32 bg-black dark:bg-white text-white dark:text-black p-4 rounded-3xl" />,
    href: "/mastra",
  },
  {
    title: "CrewAI Crews",
    description: "CrewAI is a framework for building and deploying AI agents.",
    logo: <SiCrewai className="w-32 h-32 bg-orange-500 text-white p-8 rounded-3xl" />,
    href: "/crewai-crews",
  },
  {
    title: "CrewAI Flows",
    description: "CrewAI is a framework for building and deploying AI agents.",
    logo: <SiCrewai className="w-32 h-32 bg-orange-500 text-white p-8 rounded-3xl" />,
    href: "/crewai-flows",
  },
  {
    title: "Agno",
    description: "Agno is a framework for building and deploying AI agents.",
    logo: <AgnoIcon className="w-32 h-32 bg-[#FF3C1A] text-white p-4 rounded-3xl" />,
    href: "/agno",
  },
  {
    title: "LlamaIndex",
    description: "LlamaIndex is a framework for building and deploying AI agents.",
    logo: <LlamaIndexIcon className="w-32 h-32 bg-black text-white p-2 dark:shadow-xl dark:shadow-pink-500/20 rounded-3xl" />,
    href: "/llamaindex",
  },
  {
    title: "AutoGen2",
    description: "AutoGen2 is a framework for building and deploying AI agents.",
    logo: <AG2Icon className="w-32 h-32 bg-blue-500 text-white p-4 rounded-2xl scale-1" />,
    href: "/ag2",
  },
  {
    title: "Direct to LLM",
    description: "Use CopilotKit directly with your LLM of choice. No framework required.",
    logo: <Brain className="w-32 h-32 bg-gray-500 text-white p-8 rounded-3xl" />,
    href: "/direct-to-llm/guides/quickstart",
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

const IntegrationsGrid: React.FC = () => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {integrations.map((integration, index) => (
        <IntegrationCard key={index} integration={integration} />
      ))}
    </div>
  );
};

export { IntegrationCard, IntegrationsGrid, integrations };
