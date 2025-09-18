"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useSidebar } from "fumadocs-ui/provider";
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
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const { collapsed } = useSidebar();
  const [offsetHeight, setOffsetHeight] = useState(0);
  
  // Desktop navigation state
  const [desktopNavWidth, setDesktopNavWidth] = useState(0);
  const [desktopNavState, setDesktopNavState] = useState<'full' | 'compact' | 'minimal'>('full');
  const desktopNavStateRef = useRef<'full' | 'compact' | 'minimal'>('full');
  
  // Mobile navigation state
  const [mobileNavWidth, setMobileNavWidth] = useState(0);
  const [mobileNavState, setMobileNavState] = useState<'full' | 'compact'>('full');
  const mobileNavStateRef = useRef<'full' | 'compact'>('full');
  

  // Clear pending navigation when pathname changes
  useEffect(() => {
    setPendingNavigation(null);
  }, [pathname]);

  // Keep refs in sync with states
  useEffect(() => {
    desktopNavStateRef.current = desktopNavState;
  }, [desktopNavState]);
  
  useEffect(() => {
    mobileNavStateRef.current = mobileNavState;
  }, [mobileNavState]);

  // Measure desktop navigation width and determine state
  useEffect(() => {
    const measureDesktopNavWidth = () => {
      const desktopNavItemsContainer = document.querySelector('[data-nav-container]');
      console.log('🔍 Measuring desktop nav width, container found:', !!desktopNavItemsContainer);
      
      // Only measure if the desktop nav is visible (not hidden by md:hidden)
      if (desktopNavItemsContainer && window.innerWidth >= 768) {
        const width = desktopNavItemsContainer.clientWidth;
        setDesktopNavWidth(width);
        
        // Desktop navigation states: full -> compact -> minimal
        let newState: 'full' | 'compact' | 'minimal';
        if (width < 300) {
          newState = 'minimal';
        } else if (width < 530) {
          newState = 'compact';
        } else {
          newState = 'full';
        }
        
        console.log('🔍 Desktop Nav Width Debug:', { 
          width, 
          newState, 
          currentState: desktopNavStateRef.current,
          willChange: newState !== desktopNavStateRef.current,
          timestamp: Date.now()
        });
        
        if (newState !== desktopNavStateRef.current) {
          console.log('🔄 Changing desktop nav state from', desktopNavStateRef.current, 'to', newState, 'at', width);
          desktopNavStateRef.current = newState;
          setDesktopNavState(newState);
        }
      } else {
        console.log('❌ Desktop nav items container not found');
      }
    };

    // Measure on mount
    measureDesktopNavWidth();
    
    // Debounced resize handler
    let resizeTimeout: NodeJS.Timeout;
    const debouncedMeasure = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(measureDesktopNavWidth, 100);
    };
    
    window.addEventListener('resize', debouncedMeasure);
    
    // Also measure when sidebar state changes
    const timeoutId = setTimeout(measureDesktopNavWidth, 100);
    
    return () => {
      window.removeEventListener('resize', debouncedMeasure);
      clearTimeout(resizeTimeout);
      clearTimeout(timeoutId);
    };
  }, [collapsed]);

  // Measure mobile navigation width and determine state
  useEffect(() => {
    const measureMobileNavWidth = () => {
      const mobileNavItemsContainer = document.querySelector('[data-mobile-nav-items]');
      console.log('🔍 Measuring mobile nav width, container found:', !!mobileNavItemsContainer);
      
      // Only measure if the mobile nav is visible (hidden by md:hidden means visible on < 768px)
      console.log('🔍 Mobile nav check:', { 
        containerFound: !!mobileNavItemsContainer, 
        windowWidth: window.innerWidth, 
        shouldMeasure: window.innerWidth < 768 
      });
      
      if (mobileNavItemsContainer && window.innerWidth < 768) {
        const width = mobileNavItemsContainer.clientWidth;
        setMobileNavWidth(width);
        
        // Mobile navigation states: full -> compact (icons only)
        let newState: 'full' | 'compact';
        if (width < 400) {
          newState = 'compact';
        } else {
          newState = 'full';
        }
        
        console.log('🔍 Mobile Nav Width Debug:', { 
          width, 
          newState, 
          currentState: mobileNavStateRef.current,
          willChange: newState !== mobileNavStateRef.current,
          timestamp: Date.now()
        });
        
        if (newState !== mobileNavStateRef.current) {
          console.log('🔄 Changing mobile nav state from', mobileNavStateRef.current, 'to', newState, 'at', width);
          mobileNavStateRef.current = newState;
          setMobileNavState(newState);
        }
      } else {
        console.log('❌ Mobile nav items container not found');
      }
    };

    // Measure on mount
    measureMobileNavWidth();
    
    // Debounced resize handler
    let resizeTimeout: NodeJS.Timeout;
    const debouncedMeasure = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(measureMobileNavWidth, 100);
    };
    
    window.addEventListener('resize', debouncedMeasure);
    
    return () => {
      window.removeEventListener('resize', debouncedMeasure);
      clearTimeout(resizeTimeout);
    };
  }, [collapsed]);

  // Calculate banner height and title bar height dynamically
  useEffect(() => {
    const calculateOffsets = () => {
      const banner = document.querySelector('[data-banner]') || document.querySelector('#agui-banner');
      const titleBar = document.querySelector('[data-nav]') || 
                      document.querySelector('nav') || 
                      document.querySelector('[role="banner"]') ||
                      document.querySelector('header') ||
                      document.querySelector('[data-header]') ||
                      document.querySelector('.sticky') ||
                      document.querySelector('[data-topbar]') ||
                      document.querySelector('#nd-nav');
      
      let offsetHeight = 0;
      let bannerHeight = 0;
      let titleBarHeight = 0;
      
      if (banner) {
        const style = window.getComputedStyle(banner);
        if (style.display !== 'none' && style.visibility !== 'hidden') {
          bannerHeight = banner.offsetHeight;
        }
      }
      
      if (titleBar) {
        titleBarHeight = titleBar.offsetHeight;
      } else {
        // Fallback to estimated height if we can't find the title bar
        titleBarHeight = 60;
      }
      
      const totalHeight = bannerHeight + titleBarHeight;
      setOffsetHeight(totalHeight);
    };

    // Calculate on mount
    calculateOffsets();

    // Recalculate on resize
    window.addEventListener('resize', calculateOffsets);

    // Use MutationObserver to watch for banner visibility changes
    const observer = new MutationObserver(calculateOffsets);
    observer.observe(document.body, { 
      childList: true, 
      subtree: true, 
      attributes: true, 
      attributeFilter: ['style', 'class'] 
    });

    return () => {
      window.removeEventListener('resize', calculateBannerHeight);
      observer.disconnect();
    };
  }, []);


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
    <>
      {/* Desktop Navigation - show on medium+ screens when fumadocs title bar is hidden */}
      <div 
        data-nav-container
        className="sticky top-0 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 z-30 items-center justify-between px-6 py-3 -mb-8 hidden md:flex"
        style={{ 
          height: '60px'
        }}
      >
          {/* Navigation Items - aligned with content */}
          <div data-desktop-nav-items className="flex items-center space-x-2">
            {/* Overview */}
            <button
              onClick={() => {
                setPendingNavigation("/");
                setIsIntegrationsOpen(false);
                setForceCloseDropdown(prev => prev + 1);
                router.push("/");
              }}
              className={cn(
                "flex items-center space-x-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                (pathname === "/" || pendingNavigation === "/") && !isIntegrationsOpen && pendingNavigation !== "/reference"
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
              pendingNavigation={pendingNavigation}
            />

            {/* API Reference */}
            <button
              onClick={() => {
                setPendingNavigation("/reference");
                setIsIntegrationsOpen(false);
                setForceCloseDropdown(prev => prev + 1);
                router.push("/reference");
              }}
              className={cn(
                "flex items-center space-x-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                (pathname.startsWith("/reference") || pendingNavigation === "/reference") && !isIntegrationsOpen && pendingNavigation !== "/"
                  ? "bg-primary/10 text-primary"
                  : "text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800"
              )}
              title="API Reference"
            >
              <BookOpenIcon className="w-4 h-4" />
              {desktopNavState === 'minimal' ? null : (
                <span>{desktopNavState === 'compact' ? 'Reference' : 'API Reference'}</span>
              )}
            </button>

          {/* Search Button - hide when sidebar is collapsed */}
          {!collapsed && <SearchButton />}
        </div>

      {/* Right side: External links and search */}
      <div className="flex items-center space-x-2">
        {/* Copilot Cloud */}
        <Link
          href="https://cloud.copilotkit.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center space-x-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800"
          title="Copilot Cloud"
        >
          <CloudIcon className="w-4 h-4" />
          {desktopNavState === 'minimal' ? null : (
            <span>{desktopNavState === 'compact' ? 'Cloud' : 'Copilot Cloud'}</span>
          )}
        </Link>

        {/* Community */}
        <Link
          href="https://discord.gg/qU8pXNqGJs"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center space-x-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800"
          title="Community Discord"
        >
          <SiDiscord className="w-4 h-4" />
          {desktopNavState === 'minimal' ? null : <span>Community</span>}
        </Link>

      </div>
    </div>

      {/* Mobile Navigation - show when fumadocs title bar is visible */}
      <div className="md:hidden">
        <div 
          className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 px-4 py-2 z-20"
          style={{ 
            position: 'fixed',
            top: `${offsetHeight}px`,
            left: '0',
            right: '0'
          }}
        >
          <div className="flex items-center justify-between text-sm">
            {/* Main Navigation */}
            <div data-mobile-nav-items className="flex items-center space-x-4">
              <button
                onClick={() => {
                  setPendingNavigation("/");
                  setIsIntegrationsOpen(false);
                  setForceCloseDropdown(prev => prev + 1);
                  router.push("/");
                }}
                className={cn(
                  "px-2 py-1 rounded transition-colors",
                  (pathname === "/" || pendingNavigation === "/") && !isIntegrationsOpen && pendingNavigation !== "/reference"
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-gray-700 dark:text-gray-300"
                )}
              >
                Overview
              </button>

              <IntegrationDropdown 
                options={integrationOptions} 
                onOpenChange={setIsIntegrationsOpen}
                forceClose={forceCloseDropdown}
                pendingNavigation={pendingNavigation}
              />

              <button
                onClick={() => {
                  setPendingNavigation("/reference");
                  setIsIntegrationsOpen(false);
                  setForceCloseDropdown(prev => prev + 1);
                  router.push("/reference");
                }}
                className={cn(
                  "px-2 py-1 rounded transition-colors",
                  (pathname.startsWith("/reference") || pendingNavigation === "/reference") && !isIntegrationsOpen && pendingNavigation !== "/"
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-gray-700 dark:text-gray-300"
                )}
              >
                API Ref
              </button>
            </div>

            {/* Right side: External links and search */}
            <div className="flex items-center space-x-2">
              {/* Copilot Cloud */}
              <Link
                href="https://cloud.copilotkit.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center space-x-1 px-2 py-1 rounded text-sm transition-colors text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800"
                title="Copilot Cloud"
              >
                <CloudIcon className="w-4 h-4" />
                {mobileNavState === 'compact' ? null : <span>Cloud</span>}
              </Link>

              {/* Community */}
              <Link
                href="https://discord.gg/qU8pXNqGJs"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center space-x-1 px-2 py-1 rounded text-sm transition-colors text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800"
                title="Community Discord"
              >
                <SiDiscord className="w-4 h-4" />
                {mobileNavState === 'compact' ? null : <span>Community</span>}
              </Link>

              {/* Search Button */}
              <SearchButton />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function IntegrationDropdown({ 
  options, 
  onOpenChange,
  forceClose,
  pendingNavigation
}: { 
  options: Array<{ title: string; url: string; icon: React.ReactNode; description: string }>; 
  onOpenChange: (open: boolean) => void;
  forceClose: number;
  pendingNavigation: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  
  // Reset dropdown state when pathname changes
  useEffect(() => {
    setIsOpen(false);
    onOpenChange(false);
    setPendingSelection(null); // Clear pending selection when navigation completes
  }, [pathname, onOpenChange]);

  // Force close dropdown when parent requests it
  useEffect(() => {
    if (forceClose > 0) {
      setIsOpen(false);
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

  // Show as selected if dropdown is open (and not navigating elsewhere) OR if we're on an integration page
  const shouldShowSelected = (isOpen && !pendingNavigation) || (selectedOption && !shouldResetDropdown);

  const toggleDropdown = () => {
    const newIsOpen = !isOpen;
    setIsOpen(newIsOpen);
    onOpenChange(newIsOpen);
  };

  const handleOptionClick = (url: string) => {
    setIsOpen(false);
    onOpenChange(false);
    router.push(url);
  };

  return (
    <div className="relative" data-integration-dropdown key={`dropdown-${pathname}`}>
      <button
        onClick={toggleDropdown}
        className={cn(
          "flex items-center space-x-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors focus:outline-none w-44 justify-start",
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
      className="flex items-center space-x-1 px-2 py-1 rounded text-sm transition-colors text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800"
      title="Search docs (⌘K)"
    >
      <SearchIcon className="w-4 h-4" />
      <span className="hidden sm:inline">Search</span>
    </button>
  );
}