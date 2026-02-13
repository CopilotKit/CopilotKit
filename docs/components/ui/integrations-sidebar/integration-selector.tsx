import { useState, useEffect, ComponentType, useRef } from "react";
import { flushSync } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import ChevronDownIcon from "../icons/chevron";
import AdkIcon from "../icons/adk";
import Ag2Icon from "../icons/ag2";
import AgnoIcon from "../icons/agno";
import CrewaiIcon from "../icons/crewai";
import DirectToLlmIcon from "../icons/direct-to-llm";
import LanggraphIcon from "../icons/langgraph";
import LlamaIndexIcon from "../icons/llama-index";
import MastraIcon from "../icons/mastra";
import PydanticAiIcon from "../icons/pydantic-ai";
import IntegrationPuzzleIcon from "../icons/integration-puzzle";
import CheckIcon from "../icons/check";
import { MicrosoftIcon } from "../icons/microsoft";
import { AwsStrandsIcon } from "../icons/aws-strands";
import { AgentSpecMarkIcon, A2AIcon } from "@/lib/icons/custom-icons";
import {
  INTEGRATION_ORDER,
  IntegrationId,
  getIntegration,
} from "@/lib/integrations";
import { normalizeUrl } from "@/lib/analytics-utils";

export type Integration = IntegrationId;

interface IntegrationOption {
  label: string;
  Icon: ComponentType<{ className?: string }>;
  href: string;
}

// Icon mapping - component-specific
const INTEGRATION_ICONS: Record<
  IntegrationId,
  ComponentType<{ className?: string }>
> = {
  a2a: A2AIcon,
  adk: AdkIcon,
  ag2: Ag2Icon,
  "agent-spec": AgentSpecMarkIcon,
  agno: AgnoIcon,
  "crewai-flows": CrewaiIcon,
  "crewai-crews": CrewaiIcon,
  "direct-to-llm": DirectToLlmIcon,
  langgraph: LanggraphIcon,
  llamaindex: LlamaIndexIcon,
  mastra: MastraIcon,
  "pydantic-ai": PydanticAiIcon,
  "microsoft-agent-framework": MicrosoftIcon,
  "aws-strands": AwsStrandsIcon,
};

// Build integration options from canonical order
const INTEGRATION_OPTIONS: Record<Integration, IntegrationOption> =
  Object.fromEntries(
    INTEGRATION_ORDER.map((id) => {
      const meta = getIntegration(id);
      return [
        id,
        {
          label: meta.label,
          Icon: INTEGRATION_ICONS[id],
          href: meta.href,
        },
      ];
    }),
  ) as Record<Integration, IntegrationOption>;

const DEFAULT_INTEGRATION: IntegrationOption = {
  label: "Select integration...",
  Icon: IntegrationPuzzleIcon,
  href: "/integrations",
};

interface IntegrationSelectorProps {
  selectedIntegration: Integration | null;
  setSelectedIntegration: (integration: Integration | null) => void;
  onNavigate?: () => void;
}

const IntegrationSelector = ({
  selectedIntegration,
  setSelectedIntegration,
  onNavigate,
}: IntegrationSelectorProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const isClearing = useRef(false);

  // Load persisted selection on mount (using sessionStorage for tab-specific state)
  useEffect(() => {
    const persistedSelection = sessionStorage.getItem("selectedIntegration");
    if (persistedSelection && persistedSelection !== "null") {
      setSelectedIntegration(persistedSelection as Integration);
    }
  }, [setSelectedIntegration]);

  // Listen for logo click to clear selection
  useEffect(() => {
    const handleClearSelection = () => {
      // Set flag to prevent pathname effect from re-selecting
      isClearing.current = true;
      // Clear sessionStorage immediately to prevent race condition
      sessionStorage.removeItem("selectedIntegration");
      flushSync(() => {
        setSelectedIntegration(null);
      });
      // Reset flag after a brief delay
      setTimeout(() => {
        isClearing.current = false;
      }, 100);
    };
    window.addEventListener("clearIntegrationSelection", handleClearSelection);
    return () => {
      window.removeEventListener(
        "clearIntegrationSelection",
        handleClearSelection,
      );
    };
  }, [setSelectedIntegration]);

  // Persist selection to sessionStorage when it changes (tab-specific)
  useEffect(() => {
    if (selectedIntegration) {
      sessionStorage.setItem("selectedIntegration", selectedIntegration);
    } else {
      sessionStorage.removeItem("selectedIntegration");
    }
  }, [selectedIntegration]);

  const integration = selectedIntegration
    ? INTEGRATION_OPTIONS[selectedIntegration]
    : DEFAULT_INTEGRATION;

  const { Icon } = integration;

  const handleIntegrationClick = (
    e: React.MouseEvent,
    integrationKey: Integration,
    href: string,
  ) => {
    e.preventDefault(); // Prevent Link's default navigation
    setIsOpen(false);

    // If clicking the already selected integration, dismiss it
    if (selectedIntegration === integrationKey) {
      // Set flag to prevent pathname effect from re-selecting
      isClearing.current = true;
      sessionStorage.removeItem("selectedIntegration");
      sessionStorage.setItem("lastDocsPath", "/");
      flushSync(() => {
        setSelectedIntegration(null);
      });
      router.push("/");
      onNavigate?.();
      // Reset flag after a brief delay
      setTimeout(() => {
        isClearing.current = false;
      }, 100);
      return;
    }

    // Update selection immediately
    flushSync(() => {
      setSelectedIntegration(integrationKey);
    });
    // Close the mobile sidebar when navigating, then navigate
    onNavigate?.();
    router.push(href);
  };

  useEffect(() => {
    // Don't update selection if we're in the middle of clearing (logo click)
    if (isClearing.current) {
      return;
    }

    // Normalize the pathname to handle /integrations/... paths
    const normalizedPathname = normalizeUrl(pathname);
    // Get the first segment after the leading slash
    const firstSegment = normalizedPathname.replace(/^\//, "").split("/")[0];

    // If we're on an integration page, update the selection to match the URL
    if (
      firstSegment &&
      INTEGRATION_ORDER.includes(firstSegment as IntegrationId)
    ) {
      setSelectedIntegration(firstSegment as Integration);
      return;
    }

    // Only clear selection if we're specifically on /integrations page
    if (pathname === "/integrations" && selectedIntegration) {
      setSelectedIntegration(null);
    }
  }, [pathname, selectedIntegration, setSelectedIntegration]);

  // Track last visited docs page (not reference) - tab-specific
  useEffect(() => {
    if (!pathname.startsWith("/reference")) {
      sessionStorage.setItem("lastDocsPath", pathname);
    }
  }, [pathname]);

  useEffect(() => {
    if (isHovering && !selectedIntegration && !isOpen) {
      const timer = setTimeout(() => {
        setShowTooltip(true);
      }, 3000);
      return () => {
        clearTimeout(timer);
        setShowTooltip(false);
      };
    } else {
      setShowTooltip(false);
    }
  }, [isHovering, selectedIntegration, isOpen]);

  const visibleIntegrations = Object.entries(INTEGRATION_OPTIONS);

  return (
    <div className="relative w-full">
      <div
        className={`flex justify-between items-center p-2 mt-3 mb-3 w-full h-14 rounded-lg border cursor-pointer ${
          selectedIntegration || !pathname.startsWith("/reference")
            ? "bg-[#BEC2FF33] dark:bg-[#7076D533] border-[#7076D5] dark:border-[#BEC2FF] [box-shadow:0px_17px_12px_-10px_rgba(112,118,213,0.3)]"
            : "bg-white/50 dark:bg-foreground/5 border-[#0C1112]/10 dark:border-border"
        }`}
        onClick={() => setIsOpen(!isOpen)}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            setIsOpen(!isOpen);
          }
        }}
        tabIndex={0}
        role="button"
        aria-label="Toggle integration selector"
        aria-expanded={isOpen}
      >
        <div className="flex gap-2 items-center">
          <div
            className={`flex justify-center items-center w-10 h-10 shrink-0 rounded-md ${
              selectedIntegration || !pathname.startsWith("/reference")
                ? "bg-[#BEC2FF] dark:bg-[#7076D5]"
                : "bg-[#0C1112]/5 dark:bg-white/5"
            }`}
          >
            <Icon className="text-[#0C1112] dark:text-white" />
          </div>
          <span
            className={`text-sm font-medium opacity-60 ${
              (selectedIntegration || !pathname.startsWith("/reference")) &&
              "text-foreground"
            }`}
          >
            {integration.label}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <ChevronDownIcon className="mr-1 w-4 h-4" />
        </div>
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 w-full max-w-[275px] bg-[#F7F7FA] shadow-2xl dark:bg-[#0C1112] border border-border rounded-lg p-1 z-30 max-h-[calc(100vh-200px)] overflow-y-auto custom-scrollbar">
          {visibleIntegrations.map(
            ([key, { label, Icon: OptionIcon, href }]) => (
              <Link
                key={href}
                href={href}
                className={`flex gap-2 justify-between items-center p-1 rounded-lg cursor-pointer group pr-3 ${
                  integration.href === href
                    ? "bg-[#BEC2FF33] dark:bg-[#7076D533]"
                    : "hover:bg-[#0C1112]/5 dark:hover:bg-white/5"
                }`}
                onClick={(e) =>
                  handleIntegrationClick(e, key as Integration, href)
                }
              >
                <div className="flex gap-4 items-center">
                  <div
                    className={`flex justify-center items-center w-10 h-10 shrink-0 rounded-md transition-all duration-200 ${
                      integration.href === href
                        ? "bg-[#BEC2FF] dark:bg-[#7076D5]"
                        : "bg-[#0C1112]/5 dark:bg-white/5 group-hover:bg-[#0C1112]/10 dark:group-hover:bg-white/5"
                    }`}
                  >
                    <OptionIcon className="text-[#0C1112] dark:text-white dark:group-hover:text-white transition-all duration-200" />
                  </div>
                  <span className="text-sm font-medium">{label}</span>
                </div>
                {integration.href === href && (
                  <CheckIcon className="text-[#5C64DA] dark:text-[#7076D5]" />
                )}
              </Link>
            ),
          )}
        </div>
      )}

      {showTooltip && (
        <div className="absolute top-full left-0 mt-2 w-full px-3 py-2 rounded-lg bg-[#0C1112] dark:bg-white text-white dark:text-[#0C1112] text-xs font-medium shadow-lg z-30">
          See what CopilotKit and your chosen agentic backend can do.
        </div>
      )}
    </div>
  );
};

export default IntegrationSelector;
