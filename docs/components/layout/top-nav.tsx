"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { 
  RocketIcon,
  CloudIcon, 
  TerminalIcon,
  SearchIcon,
  ChevronDownIcon,
  PlugIcon,
  BookOpenIcon
} from "lucide-react";
import { SiDiscord } from "react-icons/si";
// Removed Select imports - using custom dropdown instead
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
  const router = useRouter();
  const [isIntegrationsOpen, setIsIntegrationsOpen] = useState(false);
  const [forceCloseDropdown, setForceCloseDropdown] = useState(0);

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
      className="sticky top-0 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 z-30 flex items-center justify-between px-6 py-3 -mb-8"
      style={{ 
        height: '60px'
      }}
    >
          {/* Navigation Items - aligned with content */}
          <div className="flex items-center space-x-2">
            {/* Overview */}
            <button
              onClick={() => {
                setIsIntegrationsOpen(false);
                setForceCloseDropdown(prev => prev + 1); // Force dropdown re-render
                router.push("/");
              }}
              className={cn(
                "flex items-center space-x-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                pathname === "/" && !isIntegrationsOpen
                  ? "bg-primary/10 text-primary"
                  : "text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800"
              )}
            >
              <RocketIcon className="w-4 h-4" />
              <span>Overview</span>
            </button>

            {/* Integration Dropdown */}
            <IntegrationDropdown 
              options={integrationOptions} 
              onOpenChange={setIsIntegrationsOpen}
              forceClose={forceCloseDropdown}
            />

            {/* API Reference */}
            <button
              onClick={() => {
                setIsIntegrationsOpen(false);
                setForceCloseDropdown(prev => prev + 1); // Force dropdown re-render
                router.push("/reference");
              }}
              className={cn(
                "flex items-center space-x-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                pathname.startsWith("/reference") && !isIntegrationsOpen
                  ? "bg-primary/10 text-primary"
                  : "text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800"
              )}
            >
              <BookOpenIcon className="w-4 h-4" />
              <span>API Reference</span>
            </button>

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
            className="flex items-center space-x-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          <CloudIcon className="w-4 h-4" />
          <span>Copilot Cloud</span>
        </Link>

        {/* Community */}
        <Link
          href="https://discord.gg/qU8pXNqGJs"
          target="_blank"
          rel="noopener noreferrer"
            className="flex items-center space-x-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          <SiDiscord className="w-4 h-4" />
          <span>Community</span>
        </Link>

      </div>
    </div>
  );
}

function IntegrationDropdown({ 
  options, 
  onOpenChange,
  forceClose
}: { 
  options: Array<{ title: string; url: string; icon: React.ReactNode; description: string }>; 
  onOpenChange: (open: boolean) => void;
  forceClose: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  
  // Reset navigation state when pathname changes
  useEffect(() => {
    setIsNavigating(false);
    setIsOpen(false);
    onOpenChange(false);
  }, [pathname, onOpenChange]);

  // Force close dropdown when parent requests it
  useEffect(() => {
    if (forceClose > 0) {
      setIsOpen(false);
      setIsNavigating(false);
      onOpenChange(false);
    }
  }, [forceClose, onOpenChange]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (isOpen && !target.closest('[data-integration-dropdown]')) {
        setIsOpen(false);
        onOpenChange(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onOpenChange]);
  
  // Find the currently selected integration
  const selectedOption = options.find(option => 
    pathname.startsWith(option.url) && option.url !== "/"
  );
  
  // Check if we're on a page that should reset the dropdown
  const topLevelPages = ["/", "/reference"];
  const shouldResetDropdown = topLevelPages.some(page => 
    page === "/" ? pathname === "/" : pathname.startsWith(page)
  );

  // Show as selected if dropdown is open OR if we're on an integration page OR if we're navigating
  const shouldShowSelected = isOpen || isNavigating || (selectedOption && !shouldResetDropdown);

  const toggleDropdown = () => {
    const newIsOpen = !isOpen;
    setIsOpen(newIsOpen);
    onOpenChange(newIsOpen);
  };

  const handleOptionClick = (url: string) => {
    setIsNavigating(true);
    setIsOpen(false);
    onOpenChange(false);
    router.push(url);
  };

  return (
    <div className="relative" data-integration-dropdown>
      <button
        onClick={toggleDropdown}
        className={cn(
          "flex items-center space-x-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors focus:outline-none",
          shouldShowSelected
            ? "bg-primary/10 text-primary"
            : "text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800"
        )}
      >
        {selectedOption?.icon || <PlugIcon className="w-4 h-4" />}
        <span>{selectedOption?.title || "Integrations"}</span>
        <ChevronDownIcon className={cn("w-4 h-4 transition-transform", isOpen && "rotate-180")} />
      </button>
      
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg z-50 min-w-48">
          {options.map((option) => (
            <button
              key={option.url}
              onClick={() => handleOptionClick(option.url)}
              className="w-full flex items-center space-x-1.5 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 first:rounded-t-md last:rounded-b-md transition-colors"
            >
              <div className="flex-shrink-0">
                {option.icon}
              </div>
              <span className="font-medium">{option.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
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
      className="flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-colors text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800"
      title="Search docs (⌘K)"
    >
      <SearchIcon className="w-4 h-4" />
      <span>Search</span>
    </button>
  );
}