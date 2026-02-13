"use client";

import { ComponentType } from "react";
import Link from "fumadocs-core/link";
import { DocsLayoutProps } from "fumadocs-ui/layouts/docs";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import AdkIcon from "../icons/adk";
import Ag2Icon from "../icons/ag2";
import AgnoIcon from "../icons/agno";
import CrewaiIcon from "../icons/crewai";
import DirectToLlmIcon from "../icons/direct-to-llm";
import LanggraphIcon from "../icons/langgraph";
import LlamaIndexIcon from "../icons/llama-index";
import MastraIcon from "../icons/mastra";
import PydanticAiIcon from "../icons/pydantic-ai";
import ChevronRightIcon from "../icons/chevron";
import { MicrosoftIcon } from "../icons/microsoft";
import { AwsStrandsIcon } from "../icons/aws-strands";
import { AgentSpecMarkIcon, A2AIcon } from "@/lib/icons/custom-icons";
import { IntegrationId } from "@/lib/integrations";

type Node = DocsLayoutProps["tree"]["children"][number] & {
  url: string;
  index?: { url: string };
};

interface IntegrationLinkProps {
  node: Node;
}

type IntegrationIconProps = {
  className?: string;
  width?: number;
  height?: number;
};

// Icon mapping - should match other components
const INTEGRATION_ICONS: Record<
  IntegrationId,
  ComponentType<IntegrationIconProps>
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

const ICON_SIZE = 20;

import { normalizeUrl, normalizeUrlForMatching } from "@/lib/analytics-utils";

const IntegrationLink = ({ node }: IntegrationLinkProps) => {
  const pathname = usePathname();
  const linkUrl = node.index?.url ?? "";
  const normalizedUrl = normalizeUrl(linkUrl);
  // Use normalizeUrlForMatching for consistent comparison
  const normalizedPathname = normalizeUrlForMatching(pathname);
  const normalizedLinkUrl = normalizeUrlForMatching(linkUrl);
  const isActive =
    normalizedPathname.startsWith(normalizedLinkUrl) ||
    normalizedPathname === normalizedLinkUrl ||
    pathname.startsWith(linkUrl); // Fallback for edge cases

  const integrationKey = linkUrl.split("/").pop() ?? "";
  const Icon = INTEGRATION_ICONS[integrationKey as IntegrationId];

  return (
    <li
      className={cn(
        "flex justify-start items-center px-3 h-10 text-sm opacity-60 transition-opacity duration-300 shrink-0 hover:opacity-100 rounded-lg cursor-pointer",
        isActive && "opacity-100 bg-white/10",
      )}
    >
      <Link
        href={normalizedUrl}
        className="flex gap-2 justify-between items-center w-full h-full text-foreground dark:text-white"
      >
        <div className="flex gap-2 items-center">
          {Icon && <Icon width={ICON_SIZE} height={ICON_SIZE} />}
          {node.name}
        </div>
        <ChevronRightIcon className="text-white -rotate-90" />
      </Link>
    </li>
  );
};

export default IntegrationLink;
