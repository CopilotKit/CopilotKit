import { inject, Injector, runInInjectionContext } from "@angular/core";
import { ɵserializeContextValue } from "@copilotkit/core";
import type { ɵAgentContextInput } from "@copilotkit/core";
import { CopilotKit } from "./copilotkit";
import { explicitEffect } from "./explicit-effect";

export interface ConnectAgentContextConfig {
  injector?: Injector;
}

/**
 * Connects context to the agent. A non-string `value` is sent as its JSON
 * text, as in React and Vue.
 *
 * @param context - The context (or reactive zero-argument accessor) to connect.
 * @param config - Optional configuration for connecting the context.
 */
export function connectAgentContext(
  context: ɵAgentContextInput | (() => ɵAgentContextInput),
  config?: ConnectAgentContextConfig,
): void {
  const injector = config?.injector ?? inject(Injector);

  runInInjectionContext(injector, () => {
    const copilotkit = inject(CopilotKit);

    explicitEffect(
      () => (typeof context === "function" ? context() : context),
      (contextValue, onCleanup) => {
        const id = copilotkit.core.addContext({
          description: contextValue.description,
          value: ɵserializeContextValue(contextValue.value),
        });

        onCleanup(() => {
          copilotkit.core.removeContext(id);
        });
      },
    );
  });
}
