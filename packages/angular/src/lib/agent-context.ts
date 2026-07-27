import { effect, inject, Injector, runInInjectionContext } from "@angular/core";
import { Context } from "@ag-ui/client";
import { CopilotKit } from "./copilotkit";

export interface ConnectAgentContextConfig {
  injector?: Injector;
}

/**
 * Connects context to the agent.
 *
 * @param context - The context (or reactive zero-argument accessor) to connect.
 * @param config - Optional configuration for connecting the context.
 */
export function connectAgentContext(
  context: Context | (() => Context),
  config?: ConnectAgentContextConfig,
): void {
  const injector = config?.injector ?? inject(Injector);

  runInInjectionContext(injector, () => {
    const copilotkit = inject(CopilotKit);

    effect((teardown) => {
      const contextValue = typeof context === "function" ? context() : context;
      const id = copilotkit.core.addContext(contextValue);

      teardown(() => {
        copilotkit.core.removeContext(id);
      });
    });
  });
}
