import { useState, type ComponentType, type SVGProps } from "react";
import { cn, Icon } from "@mintlify/components";
import {
  INTEGRATIONS,
  INTEGRATION_LABELS,
  UNIVERSAL_PAGES,
  resolveIntegration,
  stripIntegrationPrefix,
  type Integration,
} from "../lib/integration";
import {
  BuiltInIcon,
  LangGraphIcon,
  ADKIcon,
  A2AIcon,
  AG2Icon,
  AgentSpecIcon,
  AgnoIcon,
  AwsStrandsIcon,
  CrewAIIcon,
  LlamaIndexIcon,
  MastraIcon,
  MicrosoftIcon,
  PydanticAIIcon,
} from "./IntegrationIcons";

type IconComponent = ComponentType<
  SVGProps<SVGSVGElement> & { className?: string }
>;

const INTEGRATION_ICONS: Record<Integration, IconComponent> = {
  "built-in": BuiltInIcon,
  langgraph: LangGraphIcon,
  adk: ADKIcon,
  a2a: A2AIcon,
  ag2: AG2Icon,
  "agent-spec": AgentSpecIcon,
  agno: AgnoIcon,
  "aws-strands": AwsStrandsIcon,
  "crewai-flows": CrewAIIcon,
  llamaindex: LlamaIndexIcon,
  mastra: MastraIcon,
  "microsoft-agent-framework": MicrosoftIcon,
  "pydantic-ai": PydanticAIIcon,
};

interface IntegrationPillProps {
  currentPath: string;
}

function IntegrationLogo({
  slug,
  className,
}: {
  slug: Integration;
  className?: string;
}) {
  const Icon = INTEGRATION_ICONS[slug];
  if (!Icon) return null;
  return (
    <Icon
      className={cn(
        "shrink-0 text-[var(--color-primary)]",
        className ?? "w-4 h-4",
      )}
      aria-hidden="true"
    />
  );
}

export function IntegrationPill({ currentPath }: IntegrationPillProps) {
  const [isOpen, setIsOpen] = useState(false);
  const current = resolveIntegration(currentPath);

  function hrefFor(target: Integration): string {
    const rest = stripIntegrationPrefix(currentPath);
    const isUniversal = (UNIVERSAL_PAGES as readonly string[]).includes(rest);
    if (target === "built-in") {
      return isUniversal ? rest : "/";
    }
    if (rest === "/") return `/${target}/quickstart`;
    return isUniversal ? `/${target}${rest}` : `/${target}/quickstart`;
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-4 py-2.5 h-10 rounded-[0.85rem] border border-gray-200/70 dark:border-gray-700/70 hover:bg-gray-600/5 dark:hover:bg-white/5 gap-1.5"
      >
        <span className="flex items-center gap-2.5 text-base font-normal text-gray-800 dark:text-gray-100 min-w-0">
          <IntegrationLogo slug={current} />
          <span className="truncate">{INTEGRATION_LABELS[current]}</span>
        </span>
        <Icon
          icon="chevron-down"
          iconLibrary="lucide"
          className={cn(
            "transition-transform text-gray-500 dark:text-gray-400",
            isOpen && "rotate-180",
          )}
          size={16}
        />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-zinc-950 border border-gray-200/70 dark:border-gray-700/70 rounded-[0.85rem] shadow-lg dark:shadow-black/50 p-1.5 z-20 max-h-[70vh] overflow-y-auto">
            {INTEGRATIONS.map((slug) => (
              <a
                key={slug}
                href={hrefFor(slug)}
                className={cn(
                  "flex items-center justify-between gap-2.5 px-2.5 py-2 text-sm font-medium rounded-[0.6rem] hover:bg-gray-100 dark:hover:bg-white/5",
                  slug === current
                    ? "text-(--primary)"
                    : "text-gray-800 dark:text-gray-200",
                )}
                onClick={() => setIsOpen(false)}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <IntegrationLogo slug={slug} />
                  <span className="truncate">{INTEGRATION_LABELS[slug]}</span>
                </span>
                {slug === current && (
                  <Icon
                    icon="check"
                    iconLibrary="lucide"
                    className="text-(--primary)"
                    size={16}
                  />
                )}
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default IntegrationPill;
