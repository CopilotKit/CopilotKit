import { HttpAgent, randomUUID, type HttpAgentConfig } from "@ag-ui/client";
import { inject } from "@angular/core";
import { CopilotKit } from "./copilotkit";
import {
  registerFrontendTool,
  registerHumanInTheLoop,
  registerRenderToolCall,
  type FrontendToolConfig,
  type HumanInTheLoopConfig,
  type RenderToolCallConfig,
} from "./tools";

export interface InitAgentStoreConfig {
  agentId: string;
  url: string;
  frontendTools?: FrontendToolConfig[];
  renderToolCalls?: RenderToolCallConfig[];
  humanInTheLoop?: HumanInTheLoopConfig[];
  /**
   * Maps the prepared agent config onto the `HttpAgent` (or subclass) that
   * is registered for `agentId`. Defaults to `new HttpAgent(agentConfig)`.
   * Use this to plug in an agent with custom headers, persistent context,
   * or incremental message history.
   */
  createAgent?: (agentConfig: HttpAgentConfig) => HttpAgent;
}

/**
 * Registers a self-managed `HttpAgent` under `agentId` together with the
 * agent-scoped frontend tools, tool-call renderers, and human-in-the-loop
 * tools it needs, so `injectAgentStore(agentId)` resolves the agent
 * afterwards. A fresh `threadId` is generated per registration.
 *
 * Must run in an injection context, but is otherwise placement-agnostic:
 * call it from an environment initializer (e.g. in route-level `providers`),
 * from a custom `injectXyz()` helper, or from any constructor or provider
 * factory. Registered tools are removed when the surrounding injection
 * context is destroyed.
 */
export function initAgentStore(config: InitAgentStoreConfig): void {
  const copilotKit = inject(CopilotKit);

  const agentConfig: HttpAgentConfig = {
    agentId: config.agentId,
    url: config.url,
    threadId: randomUUID(),
  };
  const agent = config.createAgent
    ? config.createAgent(agentConfig)
    : new HttpAgent(agentConfig);

  copilotKit.updateRuntime({
    selfManagedAgents: {
      ...copilotKit.agents(),
      [config.agentId]: agent,
    },
  });

  for (const frontendTool of config.frontendTools ?? []) {
    registerFrontendTool({ ...frontendTool, agentId: config.agentId });
  }

  for (const renderToolCall of config.renderToolCalls ?? []) {
    registerRenderToolCall({ ...renderToolCall, agentId: config.agentId });
  }

  for (const humanInTheLoop of config.humanInTheLoop ?? []) {
    registerHumanInTheLoop({ ...humanInTheLoop, agentId: config.agentId });
  }
}
