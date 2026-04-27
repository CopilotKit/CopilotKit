import type { ComponentType, SVGProps } from "react";
import { integrations, defaultIntegration } from "../../integrations.config";
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

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;

const INTEGRATION_ICONS: Record<string, IconComponent> = {
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

const TAGLINES: Record<string, string> = {
  "built-in": "Direct LLM. Tools, gen UI, threads. No framework.",
  langgraph: "Subgraphs, multi-agent flows, interrupts.",
  adk: "LlmAgent, multi-agent state, predictive updates.",
  a2a: "Agent-to-Agent protocol.",
  ag2: "AG2 / AutoGen multi-agent backends.",
  "agent-spec": "Declarative agent config (LangGraph adapter).",
  agno: "Lightweight Python multi-agent.",
  "aws-strands": "AWS-native multi-agent runtime.",
  "crewai-flows": "CrewAI Flows via Copilot Cloud.",
  llamaindex: "LlamaIndex agent workflows.",
  mastra: "TypeScript-native agents, in-process or remote.",
  "microsoft-agent-framework": ".NET and Python agents over AG-UI.",
  "pydantic-ai": "Typed Python agents — agent.to_ag_ui().",
};

export interface IntegrationGridProps {
  /** Override quickstart slug (defaults to "quickstart") */
  targetSlug?: string;
}

export function IntegrationGrid({ targetSlug = "quickstart" }: IntegrationGridProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 my-6">
      {integrations.map((i) => {
        const isDefault = i.slug === defaultIntegration;
        const href = isDefault ? `/${targetSlug}` : `/${i.slug}/${targetSlug}`;
        const Icon = INTEGRATION_ICONS[i.slug];
        return (
          <a
            key={i.slug}
            data-integration-card={i.slug}
            href={href}
            className={
              "group flex flex-col gap-2 rounded-lg border p-4 transition-colors no-underline " +
              (isDefault
                ? "border-(--primary) bg-(--primary)/5"
                : "border-gray-200 dark:border-gray-800 hover:border-(--primary)/60 hover:bg-(--primary)/5")
            }
          >
            <div className="flex items-center gap-2.5">
              {Icon ? (
                <span
                  data-color-chip
                  className="shrink-0 inline-flex items-center justify-center w-5 h-5 text-[var(--color-primary)]"
                  aria-hidden="true"
                >
                  <Icon className="w-5 h-5" />
                </span>
              ) : (
                <span
                  data-color-chip
                  className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 bg-[var(--color-primary)]"
                  aria-hidden="true"
                />
              )}
              <span className="font-semibold text-gray-900 dark:text-gray-100">{i.label}</span>
              {isDefault && (
                <span className="ml-auto text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-(--primary) text-white">
                  Start here
                </span>
              )}
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400 m-0">
              {TAGLINES[i.slug] ?? "Quickstart →"}
            </p>
          </a>
        );
      })}
    </div>
  );
}

export default IntegrationGrid;
