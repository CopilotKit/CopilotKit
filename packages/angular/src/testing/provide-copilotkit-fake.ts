import {
  DestroyRef,
  inject,
  type Provider,
  type ValueProvider,
} from "@angular/core";
import {
  COPILOT_KIT_CONFIG,
  provideCopilotKit,
  type CopilotKitConfig,
} from "@copilotkit/angular";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { FAKE_STEPWISE_AGENTS, FakeRuntime } from "./fake-runtime";
import { StepwiseAgent } from "./step-wise.agent";

/**
 * Provides CopilotKit with controllable agents and no runtime URL.
 * Use instead of `provideCopilotKit`.
 * Pass the renderer/tool configuration needed by the test here.
 * `agentIds` registers one stepwise agent per id. Omit it for the default agent only.
 * Inject `FakeRuntime` to emit events and close each run's stream.
 * The Inspector is disabled unless explicitly enabled.
 */
export function provideCopilotKitFake(
  config: Omit<
    CopilotKitConfig,
    "runtimeUrl" | "agents" | "selfManagedAgents"
  > & {
    agentIds?: readonly string[];
  } = {},
): Provider[] {
  const { agentIds = [DEFAULT_AGENT_ID], ...copilotKitConfig } = config;
  const resolved = provideCopilotKit({
    ...copilotKitConfig,
    enableInspector: copilotKitConfig.enableInspector ?? false,
    runtimeUrl: undefined,
    agents: undefined,
    selfManagedAgents: undefined,
  }) as ValueProvider;

  return [
    {
      provide: FAKE_STEPWISE_AGENTS,
      useFactory: () => {
        const agents = new Map(
          agentIds.map((agentId) => [agentId, new StepwiseAgent({ agentId })]),
        );
        inject(DestroyRef).onDestroy(() => {
          for (const agent of agents.values()) agent.complete();
        });
        return agents;
      },
    },
    FakeRuntime,
    {
      provide: COPILOT_KIT_CONFIG,
      useFactory: (): CopilotKitConfig => ({
        ...resolved.useValue,
        agents: Object.fromEntries(inject(FAKE_STEPWISE_AGENTS)),
      }),
    },
  ];
}
