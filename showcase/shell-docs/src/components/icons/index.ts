/**
 * Icon registry for shell-docs.
 *
 * `customIcons` maps stable string keys to icon components and is consumed by:
 * - `FrameworkOverview` (via `iconKey` prop), and
 * - integration `index.mdx` files that previously referenced `customIcons.<key>`
 *   from `docs/lib/icons/custom-icons.tsx`.
 *
 * Keys mirror the legacy `docs/` registry so MDX references remain stable.
 */
import {
  AdkIcon,
  Ag2Icon,
  AgnoIcon,
  AnthropicIcon,
  CrewaiIcon,
  DeepAgentsIcon,
  LanggraphIcon,
  LlamaIndexIcon,
  MastraIcon,
  MicrosoftIcon,
  PydanticAiIcon,
  SpringIcon,
  StrandsIcon,
} from "./framework-icons";
import { A2AIcon } from "./a2a";
import { AgentSpecMarkIcon } from "./agent-spec-mark";

export const customIcons = {
  a2a: A2AIcon,
  adk: AdkIcon,
  ag2: Ag2Icon,
  agentspecMark: AgentSpecMarkIcon,
  agno: AgnoIcon,
  anthropic: AnthropicIcon,
  awsStrands: StrandsIcon,
  crewai: CrewaiIcon,
  deepagents: DeepAgentsIcon,
  langgraph: LanggraphIcon,
  llamaindex: LlamaIndexIcon,
  mastra: MastraIcon,
  microsoft: MicrosoftIcon,
  pydantic: PydanticAiIcon,
  spring: SpringIcon,
} as const;

export type IconKey = keyof typeof customIcons;
