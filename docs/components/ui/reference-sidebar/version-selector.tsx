"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import ChevronDownIcon from "../icons/chevron";
import CheckIcon from "../icons/check";

export type ReferenceVersion = "v1" | "v2";

const VERSION_OPTIONS: { value: ReferenceVersion; label: string }[] = [
  { value: "v2", label: "v2 (Latest)" },
  { value: "v1", label: "v1" },
];

/**
 * Maps v1 page suffixes to their v2 equivalents and vice versa.
 * Suffix is the path after `/reference/vN/`, e.g. "hooks/useCopilotAction".
 * When switching versions, if the direct path doesn't exist in the target,
 * we look up the closest equivalent here, or fall back to the version root.
 */
const V1_TO_V2: Record<string, string> = {
  "hooks/useCopilotAction": "hooks/useFrontendTool",
  "hooks/useCopilotReadable": "hooks/useAgentContext",
  "hooks/useCopilotAdditionalInstructions": "hooks/useAgentContext",
  "hooks/useCopilotChat": "hooks/useAgent",
  "hooks/useCopilotChatHeadless_c": "hooks/useAgent",
  "hooks/useCopilotChatSuggestions": "hooks/useConfigureSuggestions",
  "hooks/useCoAgent": "hooks/useAgent",
  "hooks/useCoAgentStateRender": "hooks/useRenderToolCall",
  "hooks/useDefaultTool": "hooks/useFrontendTool",
  "hooks/useLangGraphInterrupt": "hooks/useHumanInTheLoop",
  "components/chat/CopilotChat": "components/CopilotChat",
  "components/chat/CopilotPopup": "components/CopilotPopup",
  "components/chat/CopilotSidebar": "components/CopilotSidebar",
  "components/chat": "components/CopilotChat",
};

// Build the reverse mapping (v2 → v1) from the forward mapping.
// For many-to-one mappings, the first entry wins.
const V2_TO_V1: Record<string, string> = {};
for (const [v1Path, v2Path] of Object.entries(V1_TO_V2)) {
  if (!(v2Path in V2_TO_V1)) {
    V2_TO_V1[v2Path] = v1Path;
  }
}

function resolveVersionPath(
  suffix: string,
  fromVersion: ReferenceVersion,
  toVersion: ReferenceVersion,
): string {
  const map = fromVersion === "v1" ? V1_TO_V2 : V2_TO_V1;
  // Exact match in the mapping → use the equivalent page
  if (suffix in map) {
    return `/reference/${toVersion}/${map[suffix]}`;
  }
  // Direct path exists in target (same page name in both versions) → keep it.
  // Pages that exist in both: hooks/useAgent, hooks/useFrontendTool, hooks/useHumanInTheLoop,
  // hooks/useRenderToolCall, components/CopilotKit, etc.
  // We can't check the filesystem from the client, so we maintain a set of
  // known pages per version and verify against that.
  // For simplicity, if it's not in the mapping, try the direct path — the
  // fallback below will catch pages that only exist in one version.
  const directPath = `/reference/${toVersion}/${suffix}`;

  // Pages that only exist in v1 (no v2 equivalent at all)
  const v1Only = new Set([
    "classes/CopilotRuntime",
    "classes/CopilotTask",
    "classes/llm-adapters/OpenAIAdapter",
    "classes/llm-adapters/OpenAIAssistantAdapter",
    "classes/llm-adapters/AnthropicAdapter",
    "classes/llm-adapters/LangChainAdapter",
    "classes/llm-adapters/GoogleGenerativeAIAdapter",
    "classes/llm-adapters/GroqAdapter",
    "sdk/python/LangGraph",
    "sdk/python/LangGraphAgent",
    "sdk/python/CrewAI",
    "sdk/python/CrewAIAgent",
    "sdk/python/RemoteEndpoints",
    "sdk/js/LangGraph",
    "components/CopilotTextarea",
  ]);

  // Pages that only exist in v2 (no v1 equivalent)
  const v2Only = new Set([
    "hooks/useAgentContext",
    "hooks/useSuggestions",
    "hooks/useConfigureSuggestions",
    "hooks/useCopilotKit",
    "hooks/useCopilotChatConfiguration",
    "components/CopilotChatView",
    "components/CopilotChatMessageView",
    "components/CopilotChatAssistantMessage",
    "components/CopilotChatUserMessage",
    "components/CopilotChatInput",
  ]);

  const blockedSet = toVersion === "v2" ? v1Only : v2Only;
  if (blockedSet.has(suffix)) {
    return `/reference/${toVersion}`;
  }

  return directPath;
}

interface VersionSelectorProps {
  onNavigate?: () => void;
}

export function getVersionFromPathname(pathname: string): ReferenceVersion {
  if (pathname.startsWith("/reference/v1")) return "v1";
  return "v2";
}

const VersionSelector = ({ onNavigate }: VersionSelectorProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentVersion = getVersionFromPathname(pathname);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleVersionClick = (version: ReferenceVersion) => {
    setIsOpen(false);
    if (version === currentVersion) return;

    // Extract the page suffix after `/reference/vN/`
    const prefix = `/reference/${currentVersion}/`;
    const suffix = pathname.startsWith(prefix)
      ? pathname.slice(prefix.length)
      : "";

    const newPath = suffix
      ? resolveVersionPath(suffix, currentVersion, version)
      : `/reference/${version}`;

    onNavigate?.();
    router.push(newPath);
  };

  const currentOption = VERSION_OPTIONS.find(
    (opt) => opt.value === currentVersion,
  )!;

  return (
    <div className="relative w-full" ref={dropdownRef}>
      <div
        className="flex justify-between items-center p-2 mt-3 mb-3 w-full h-12 rounded-lg border cursor-pointer bg-[#BEC2FF33] dark:bg-[#7076D533] border-[#7076D5] dark:border-[#BEC2FF] [box-shadow:0px_17px_12px_-10px_rgba(112,118,213,0.3)]"
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            setIsOpen(!isOpen);
          }
        }}
        tabIndex={0}
        role="button"
        aria-label="Select API version"
        aria-expanded={isOpen}
      >
        <div className="flex gap-2 items-center">
          <div className="flex justify-center items-center w-8 h-8 shrink-0 rounded-md bg-[#BEC2FF] dark:bg-[#7076D5]">
            <span className="text-xs font-bold text-[#0C1112] dark:text-white">
              API
            </span>
          </div>
          <span className="text-sm font-medium text-foreground">
            {currentOption.label}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <ChevronDownIcon className="mr-1 w-4 h-4" />
        </div>
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 w-full bg-[#F7F7FA] shadow-2xl dark:bg-[#0C1112] border border-border rounded-lg p-1 z-30">
          {VERSION_OPTIONS.map(({ value, label }) => (
            <div
              key={value}
              className={`flex gap-2 justify-between items-center p-2 rounded-lg cursor-pointer group pr-3 ${
                currentVersion === value
                  ? "bg-[#BEC2FF33] dark:bg-[#7076D533]"
                  : "hover:bg-[#0C1112]/5 dark:hover:bg-white/5"
              }`}
              onClick={() => handleVersionClick(value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  handleVersionClick(value);
                }
              }}
              tabIndex={0}
              role="option"
              aria-selected={currentVersion === value}
            >
              <span className="text-sm font-medium">{label}</span>
              {currentVersion === value && (
                <CheckIcon className="text-[#5C64DA] dark:text-[#7076D5]" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default VersionSelector;
