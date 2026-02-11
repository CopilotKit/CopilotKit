import { effect, inject, Injector, runInInjectionContext, Signal } from "@angular/core";
import { Context } from "@ag-ui/client";
import { CopilotKit } from "./copilotkit";

export interface ConnectAgentContextConfig {
  injector?: Injector;
}

/**
 * Connects context to the agent.
 *
 * @param context - The context (or a signal of context) to connect to the agent.
 * @param config - Optional configuration for connecting the context.
 */
export function connectAgentContext(context: Context | Signal<Context>, config?: ConnectAgentContextConfig) {
  const injector = inject(Injector, { optional: true }) ?? config?.injector;

  if (!injector) {
    throw new Error(
      "Injector not found. You must call connectAgentContext in an injector context or pass an injector in the config",
    );
  }

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
