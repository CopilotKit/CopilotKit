"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { 
  RocketIcon,
  CloudIcon, 
  TerminalIcon,
  SearchIcon,
  ChevronDownIcon,
  PlugIcon
} from "lucide-react";
import { SiDiscord } from "react-icons/si";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SiCrewai } from "@icons-pack/react-simple-icons";
import { SiLangchain } from "react-icons/si";
import {
  AG2Icon,
  MastraIcon,
  AgnoIcon,
  LlamaIndexIcon,
  PydanticAIIcon,
} from "@/lib/icons/custom-icons";

export function TopNav() {
  const pathname = usePathname();

  // Integration options for the dropdown
  const integrationOptions = [
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
    },
    {
      title: "LangGraph",
      description: "Documentation for CoAgents with LangGraph",
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
    },
    {
      title: "Mastra",
      description: "Documentation for CoAgents with Mastra",
      url: "/mastra",
      icon: <MastraIcon className="w-4 h-4 text-bold" />,
    },
    {
      title: "CrewAI Crews",
      description: "Documentation for CoAgents with CrewAI Crews",
      url: "/crewai-crews",
      icon: <SiCrewai className="w-4 h-4 text-bold" />,
    },
    {
      title: "CrewAI Flows",
      description: "Documentation for CoAgents with CrewAI Flows",
      url: "/crewai-flows",
      icon: <SiCrewai className="w-4 h-4 text-bold" />,
    },
    {
      title: "PydanticAI",
      description: "Documentation for CoAgents with PydanticAI",
      url: "/pydantic-ai",
      icon: <PydanticAIIcon className="w-4 h-4 text-bold" />,
    },
    {
      title: "Agno",
      description: "Documentation for CoAgents with Agno",
      url: "/agno",
      icon: <AgnoIcon className="w-4 h-4 text-bold" />,
    },
    {
      title: "LlamaIndex",
      description: "Documentation for CoAgents with LlamaIndex",
      url: "/llamaindex",
      icon: <LlamaIndexIcon className="w-4 h-4 text-bold" />,
    },
    {
      title: "AutoGen2",
      description: "Documentation for CoAgents with AG2",
      url: "/ag2",
      icon: <AG2Icon className="w-4 h-4 text-bold" />,
    },
  ];

  const navItems = [
    {
      href: "/",
      label: "Overview",
      icon: RocketIcon,
      isActive: pathname === "/"
    },
    {
      href: "/reference",
      label: "API Reference",
      icon: TerminalIcon,
      isActive: pathname.startsWith("/reference")
    }
  ];

  return (
    <div 
      className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-gray-200 z-30 flex items-center justify-between px-6 py-3 -mb-8"
      style={{ 
        height: '60px'
      }}
    >
          {/* Navigation Items - aligned with content */}
          <div className="flex items-center space-x-2">
            {/* Overview */}
            <Link
              href="/"
              className={cn(
                "flex items-center space-x-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                pathname === "/"
                  ? "text-purple-600 border-b-2 border-purple-600"
                  : "text-gray-700 hover:text-gray-900 hover:bg-gray-50"
              )}
            >
              <RocketIcon className="w-4 h-4" />
              <span>Overview</span>
            </Link>

            {/* Integration Dropdown */}
            <IntegrationDropdown options={integrationOptions} />

            {/* API Reference */}
            <Link
              href="/reference"
              className={cn(
                "flex items-center space-x-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                pathname.startsWith("/reference")
                  ? "text-purple-600 border-b-2 border-purple-600"
                  : "text-gray-700 hover:text-gray-900 hover:bg-gray-50"
              )}
            >
              <TerminalIcon className="w-4 h-4" />
              <span>API Reference</span>
            </Link>

          {/* Search Button */}
          <SearchButton />
        </div>

      {/* Right side: External links and search */}
      <div className="flex items-center space-x-2">
        {/* Copilot Cloud */}
        <Link
          href="https://cloud.copilotkit.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center space-x-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors text-gray-700 hover:text-gray-900 hover:bg-gray-50"
        >
          <CloudIcon className="w-4 h-4" />
          <span>Copilot Cloud</span>
        </Link>

        {/* Community */}
        <Link
          href="https://discord.gg/qU8pXNqGJs"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center space-x-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors text-gray-700 hover:text-gray-900 hover:bg-gray-50"
        >
          <SiDiscord className="w-4 h-4" />
          <span>Community</span>
        </Link>

      </div>
    </div>
  );
}

function IntegrationDropdown({ options }: { options: Array<{ title: string; url: string; icon: React.ReactNode; description: string }> }) {
  const router = useRouter();
  const pathname = usePathname();
  
  // Find the currently selected integration
  const selectedOption = options.find(option => 
    pathname.startsWith(option.url) && option.url !== "/"
  );
  
  // Check if we're on a page that should reset the dropdown
  const topLevelPages = ["/", "/reference"];
  const shouldResetDropdown = topLevelPages.some(page => 
    page === "/" ? pathname === "/" : pathname.startsWith(page)
  );

  return (
    <Select
      value={shouldResetDropdown ? undefined : selectedOption?.url}
      onValueChange={(url) => {
        router.push(url);
      }}
    >
      <SelectTrigger
        className={cn(
          "h-auto px-3 py-2 border-0 bg-transparent shadow-none flex items-center space-x-2 text-sm font-medium transition-colors rounded-md w-auto [&>svg]:hidden",
          selectedOption && !shouldResetDropdown
            ? "text-purple-600 border-b-2 border-purple-600"
            : "text-gray-700 hover:text-gray-900 hover:bg-gray-50"
        )}
      >
        <div className="flex items-center space-x-1.5">
          {selectedOption?.icon || <PlugIcon className="w-4 h-4" />}
          <span>{selectedOption?.title || "Integrations"}</span>
        </div>
      </SelectTrigger>
      <SelectContent className="w-auto min-w-48">
        {options.map((option) => (
          <SelectItem
            key={option.url}
            value={option.url}
            className="cursor-pointer"
          >
            <div className="flex items-center space-x-1.5">
              <div className="flex-shrink-0">
                {option.icon}
              </div>
              <span className="text-sm font-medium">{option.title}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SearchButton() {
  const toggleSearch = () => {
    const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        metaKey: isMac,
        ctrlKey: !isMac,
        bubbles: true,
      })
    );
  };
  
  return (
    <button 
      onClick={toggleSearch} 
      className="flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-colors text-gray-700 hover:text-gray-900 hover:bg-gray-50"
      title="Search docs (⌘K)"
    >
      <SearchIcon className="w-4 h-4" />
      <span>Search</span>
    </button>
  );
}