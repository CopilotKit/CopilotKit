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
  ChevronDownIcon,
  PlugIcon,
  BookOpenIcon
} from "lucide-react";
import { SiDiscord } from "react-icons/si";
// Removed Select imports - using custom dropdown instead
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

// Function to update nd-tocnav, nd-toc, sidebar, and subnav positioning based on actual measured heights
const updateTocNavPosition = (totalHeight: number, bannerHeight: number, isCollapsed: boolean) => {
  const tocNav = document.querySelector('#nd-tocnav') as HTMLElement;
  const toc = document.querySelector('#nd-toc') as HTMLElement;
  const sidebar = document.querySelector('#nd-sidebar') as HTMLElement;
  const subnav = document.querySelector('#nd-subnav') as HTMLElement;

  console.log('🔧 Updating TOC nav position:', { totalHeight, bannerHeight, isCollapsed });
  
  if (tocNav) {
    // Check if we're in mobile view to include subnav height
    const isMobile = window.innerWidth < 768;
    let topPosition = totalHeight;
    
    if (isMobile && subnav) {
      // In mobile view, position tocNav below banner + mobile nav + subnav
      topPosition += subnav.offsetHeight;
      console.log('🔧 Mobile view: adding subnav height:', subnav.offsetHeight);
    }
    
    const paddingTop = 16; // 16px additional internal padding
    tocNav.style.top = `${topPosition}px`;
    tocNav.style.paddingTop = `${paddingTop}px`;
    console.log('🔧 Updated #nd-tocnav:', { 
      top: `${topPosition}px`, 
      paddingTop: `${paddingTop}px`, 
      totalHeight, 
      isMobile,
      subnavHeight: subnav ? subnav.offsetHeight : 0 
    });
  }
  
  // Update Table of Contents positioning
  if (toc) {
    const topPosition = totalHeight;
    const paddingTop = 30; // 30px additional internal padding
    toc.style.top = `${topPosition}px`;
    toc.style.paddingTop = `${paddingTop}px`;
  }
  
  if (sidebar) {
    const topPosition = bannerHeight; // Sidebar should be positioned below banner only
    sidebar.style.top = `${topPosition}px`;
  }
  
  if (subnav) {
    const topPosition = bannerHeight; // Subnav should be positioned below banner only
    subnav.style.top = `${topPosition}px`;
  }
  
  // Handle collapsed sidebar button positioning
  const collapseButton = document.querySelector('[aria-label="Collapse Sidebar"]') as HTMLElement;
  if (collapseButton) {
    const parent = collapseButton.parentElement as HTMLElement;
    
    // Check if we're in mobile view (< 768px)
    const isMobile = window.innerWidth < 768;
    
    if (isMobile) {
      // Hide collapsed sidebar in mobile view since nd-subnav shows the same content
      if (parent) {
        parent.style.display = 'none';
      }
    } else if (isCollapsed) {
      // Desktop view with collapsed sidebar - position it correctly
      if (parent) {
        parent.style.display = ''; // Ensure it's visible
        
        // Get the height of the tocnav if it exists
        const tocnav = document.querySelector('#nd-tocnav') as HTMLElement;
        const tocnavHeight = tocnav ? tocnav.offsetHeight : 0;
        const paddingTop = 16;
        const topPosition = totalHeight + paddingTop + tocnavHeight;
        
        parent.style.top = `${topPosition}px`;
      }
    } else {
      // Desktop view with expanded sidebar - reset positioning
      if (parent) {
        parent.style.display = ''; // Ensure it's visible
        parent.style.top = ''; // Reset to default positioning
      }
    }
  }
};

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
  const [mobileNavState, setMobileNavState] = useState<'full' | 'compact' | 'minimal'>('full');
  const mobileNavStateRef = useRef<'full' | 'compact' | 'minimal'>('full');
  

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
        if (width < 650) {
          newState = 'minimal';
        } else if (width < 740) {
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
      const mobileNavItemsContainer = document.querySelector('[data-mobile-nav-container]');
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
        
        // Mobile navigation states: full -> compact -> minimal
        let newState: 'full' | 'compact' | 'minimal';
        if (width < 460) {
          newState = 'minimal';
        } else if (width < 655) {
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
      
      let bannerHeight = 0;
      
      if (banner && banner instanceof HTMLElement) {
        const style = window.getComputedStyle(banner);
        if (style.display !== 'none' && style.visibility !== 'hidden') {
          bannerHeight = banner.offsetHeight;
        }
      }
      
      // Keep the original nav positioning logic intact
      // Find fumadocs title bar for nav positioning (not our custom nav)
      const fumadocsNav = document.querySelector('[data-nav]') || 
                         document.querySelector('nav:not([data-nav-container]):not([data-mobile-nav-container])') || 
                         document.querySelector('[role="banner"]') ||
                         document.querySelector('header:not([data-nav-container]):not([data-mobile-nav-container])') ||
                         document.querySelector('[data-topbar]') ||
                         document.querySelector('#nd-nav');
      
      let fumadocsNavHeight = 0;
      if (fumadocsNav && fumadocsNav instanceof HTMLElement) {
        fumadocsNavHeight = fumadocsNav.offsetHeight;
      } else {
        fumadocsNavHeight = 60; // fallback
      }
      
      // For top nav positioning, use banner + fumadocs nav height
      const navOffsetHeight = bannerHeight + fumadocsNavHeight;
      setOffsetHeight(navOffsetHeight);
      
      // For TOC positioning, we need banner height + our actual custom nav height
      const calculateTocPosition = () => {
        const desktopNav = document.querySelector('[data-nav-container]');
        const mobileNav = document.querySelector('[data-mobile-nav-container]');
        
        let customNavHeight = 0;
        
        // Check which custom nav is currently visible and get its height
        if (desktopNav && window.innerWidth >= 768 && !collapsed) {
          customNavHeight = (desktopNav as HTMLElement).offsetHeight;
          console.log('🔍 Using desktop nav height for TOC:', customNavHeight);
        } else if (mobileNav && (window.innerWidth < 768 || collapsed)) {
          customNavHeight = (mobileNav as HTMLElement).offsetHeight;
          console.log('🔍 Using mobile nav height for TOC:', customNavHeight);
        } else {
          // No custom nav visible, use fumadocs nav height
          customNavHeight = fumadocsNavHeight;
          console.log('🔍 Using fumadocs nav height for TOC:', customNavHeight);
        }
        
        const tocTotalHeight = bannerHeight + customNavHeight;
        
        console.log('🔍 TOC Height calculation:', { 
          bannerHeight, 
          customNavHeight, 
          tocTotalHeight,
          fumadocsNavHeight,
          navOffsetHeight,
          windowWidth: window.innerWidth,
          collapsed
        });
        
        updateTocNavPosition(tocTotalHeight, bannerHeight, collapsed);
      };
      
      // Calculate TOC position after a brief delay to ensure nav is rendered
      setTimeout(calculateTocPosition, 0);
    };

    // Calculate on mount
    calculateOffsets();

    // Recalculate on resize
    window.addEventListener('resize', calculateOffsets);

    // Create observers for specific elements that affect layout
    const observers: Array<MutationObserver | ResizeObserver> = [];

    // Watch for banner being added/removed/hidden from DOM (banner dismissal)
    const bannerContainerObserver = new MutationObserver((mutations) => {
      let shouldRecalculate = false;
      
      mutations.forEach((mutation) => {
        // Check if banner was added or removed
        if (mutation.type === 'childList') {
          const addedBanners = Array.from(mutation.addedNodes).some(node => 
            node.nodeType === Node.ELEMENT_NODE && 
            ((node as Element).hasAttribute('data-banner') || 
             (node as Element).id === 'agui-banner' ||
             (node as Element).querySelector('[data-banner]') ||
             (node as Element).querySelector('#agui-banner'))
          );
          const removedBanners = Array.from(mutation.removedNodes).some(node => 
            node.nodeType === Node.ELEMENT_NODE && 
            ((node as Element).hasAttribute('data-banner') || 
             (node as Element).id === 'agui-banner' ||
             (node as Element).querySelector('[data-banner]') ||
             (node as Element).querySelector('#agui-banner'))
          );
          
          if (addedBanners || removedBanners) {
            shouldRecalculate = true;
          }
        }
        
        // Also check if banner visibility/display changed
        if (mutation.type === 'attributes' && 
            mutation.target.nodeType === Node.ELEMENT_NODE) {
          const target = mutation.target as Element;
          if (target.hasAttribute('data-banner') || 
              target.id === 'agui-banner' ||
              target.closest('[data-banner]') ||
              target.closest('#agui-banner')) {
            shouldRecalculate = true;
          }
        }
      });
      
      if (shouldRecalculate) {
        // Use setTimeout to avoid calling during DOM manipulation
        setTimeout(calculateOffsets, 0);
      }
    });
    
    // Watch the document for banner changes - look at a more specific container if possible
    const bannerContainer = document.querySelector('body') || document.documentElement;
    bannerContainerObserver.observe(bannerContainer, { 
      childList: true, 
      subtree: true, 
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden']
    });
    observers.push(bannerContainerObserver);

    // Watch banner for visibility/style changes (if it exists)
    const banner = document.querySelector('[data-banner]') || document.querySelector('#agui-banner');
    if (banner) {
      const bannerObserver = new MutationObserver(calculateOffsets);
      bannerObserver.observe(banner, { 
        attributes: true, 
        attributeFilter: ['style', 'class', 'hidden'] 
      });
      observers.push(bannerObserver);

      // Also watch banner size changes
      const bannerResizeObserver = new ResizeObserver(calculateOffsets);
      bannerResizeObserver.observe(banner);
      observers.push(bannerResizeObserver);
    }

    // Watch fumadocs nav for changes
    const fumadocsNav = document.querySelector('#nd-nav');
    if (fumadocsNav) {
      const navObserver = new MutationObserver(calculateOffsets);
      navObserver.observe(fumadocsNav, { 
      attributes: true, 
      attributeFilter: ['style', 'class'] 
      });
      observers.push(navObserver);

      const navResizeObserver = new ResizeObserver(calculateOffsets);
      navResizeObserver.observe(fumadocsNav);
      observers.push(navResizeObserver);
    }

    // Watch our custom nav containers for changes
    const desktopNav = document.querySelector('[data-nav-container]');
    if (desktopNav) {
      const desktopNavResizeObserver = new ResizeObserver(calculateOffsets);
      desktopNavResizeObserver.observe(desktopNav);
      observers.push(desktopNavResizeObserver);
    }

    const mobileNav = document.querySelector('[data-mobile-nav-container]');
    if (mobileNav) {
      const mobileNavResizeObserver = new ResizeObserver(calculateOffsets);
      mobileNavResizeObserver.observe(mobileNav);
      observers.push(mobileNavResizeObserver);
    }

    // Watch for TOC changes (pages with/without TOC)
    const tocObserver = new MutationObserver((mutations) => {
      let shouldRecalculate = false;
      
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          // Check if TOC elements were added or removed
          const tocChanges = Array.from(mutation.addedNodes).some(node => 
            node.nodeType === Node.ELEMENT_NODE && 
            ((node as Element).id === 'nd-toc' || 
             (node as Element).id === 'nd-tocnav' ||
             (node as Element).querySelector('#nd-toc') ||
             (node as Element).querySelector('#nd-tocnav'))
          ) || Array.from(mutation.removedNodes).some(node => 
            node.nodeType === Node.ELEMENT_NODE && 
            ((node as Element).id === 'nd-toc' || 
             (node as Element).id === 'nd-tocnav' ||
             (node as Element).querySelector('#nd-toc') ||
             (node as Element).querySelector('#nd-tocnav'))
          );
          
          if (tocChanges) {
            shouldRecalculate = true;
          }
        }
      });
      
      if (shouldRecalculate) {
        // Delay to allow page transition to complete
        setTimeout(calculateOffsets, 100);
      }
    });
    
    // Watch the main content area for TOC changes
    const mainContent = document.querySelector('main') || document.body;
    tocObserver.observe(mainContent, { 
      childList: true, 
      subtree: true 
    });
    observers.push(tocObserver);

    return () => {
      window.removeEventListener('resize', calculateOffsets);
      observers.forEach(observer => observer.disconnect());
    };
  }, [collapsed]);

  // Handle route changes (Next.js 13+ App Router)
  useEffect(() => {
    // Delay to allow new page content to render and TOC to be added/removed
    const timer = setTimeout(() => {
      const calculateOffsets = () => {
        const banner = document.querySelector('[data-banner]') || document.querySelector('#agui-banner');
        const nav = document.querySelector('[data-nav]') || 
                   document.querySelector('nav:not([data-nav-container]):not([data-mobile-nav-container])') || 
                   document.querySelector('[role="banner"]') ||
                   document.querySelector('header:not([data-nav-container]):not([data-mobile-nav-container])') ||
                   document.querySelector('[data-topbar]') ||
                   document.querySelector('#nd-nav');
        
        let bannerHeight = 0;
        let fumadocsNavHeight = 0;
        
        // Check if banner exists and is visible
        if (banner && banner instanceof HTMLElement && banner.offsetHeight > 0 && getComputedStyle(banner).display !== 'none') {
          bannerHeight = banner.offsetHeight;
        }
        
        if (nav && nav instanceof HTMLElement) {
          fumadocsNavHeight = nav.offsetHeight;
        } else {
          fumadocsNavHeight = 60; // fallback
        }
        
        const navOffsetHeight = bannerHeight + fumadocsNavHeight;
        setOffsetHeight(navOffsetHeight);
        
        // Update TOC positioning
        const calculateTocPosition = () => {
          const desktopNav = document.querySelector('[data-nav-container]');
          const mobileNav = document.querySelector('[data-mobile-nav-container]');
          
          let customNavHeight = 0;
          
          if (desktopNav && window.innerWidth >= 768 && !collapsed) {
            customNavHeight = (desktopNav as HTMLElement).offsetHeight;
          } else if (mobileNav && (window.innerWidth < 768 || collapsed)) {
            customNavHeight = (mobileNav as HTMLElement).offsetHeight;
          } else {
            customNavHeight = fumadocsNavHeight;
          }
          
          const tocTotalHeight = bannerHeight + customNavHeight;
          updateTocNavPosition(tocTotalHeight, bannerHeight, collapsed);
        };
        
        setTimeout(calculateTocPosition, 0);
      };
      
      calculateOffsets();
    }, 200);
    
    return () => clearTimeout(timer);
  }, [pathname, collapsed]); // Recalculate when pathname changes

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
      title: "ADK",
      description: "Documentation for CoAgents with ADK",
      url: "/adk",
      icon: <ADKIcon className="w-4 h-4 text-bold" />,
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
        className={cn(
          "fixed bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 z-30 items-center justify-between px-6 py-3 hidden md:flex",
          collapsed && "md:hidden"
        )}
        style={{ 
          height: '60px',
          top: `${offsetHeight}px`,
          left: !collapsed ? '286px' : '0',
          right: '0'
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

        </div>

      {/* Right side: External links */}
      <div className="flex items-center space-x-2">
        {/* Copilot Cloud */}
        <Link
          href="https://cloud.copilotkit.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center space-x-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800"
          title="Copilot Cloud"
          suppressHydrationWarning={true}
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
          data-mobile-nav-container
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
                  "flex items-center space-x-1 px-2 py-1 rounded transition-colors",
                  (pathname.startsWith("/reference") || pendingNavigation === "/reference") && !isIntegrationsOpen && pendingNavigation !== "/"
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-gray-700 dark:text-gray-300"
                )}
              >
                <BookOpenIcon className="w-4 h-4" />
                {mobileNavState === 'full' ? <span>Reference</span> : null}
              </button>
            </div>

            {/* Right side: External links and search */}
            <div className="flex items-center space-x-2">
              {/* Copilot Cloud - hide in minimal state */}
              {mobileNavState !== 'minimal' && (
                <Link
                  href="https://cloud.copilotkit.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center space-x-1 px-2 py-1 rounded text-sm transition-colors text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800"
                  title="Copilot Cloud"
                  suppressHydrationWarning={true}
                >
                  <CloudIcon className="w-4 h-4" />
                  {mobileNavState === 'compact' ? null : <span>Cloud</span>}
                </Link>
              )}

              {/* Community - hide in minimal state */}
              {mobileNavState !== 'minimal' && (
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
              )}

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
          "flex items-center space-x-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors focus:outline-none justify-start",
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
