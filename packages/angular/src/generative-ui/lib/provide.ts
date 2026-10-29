import {
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
} from "@angular/core";
import type { EnvironmentProviders } from "@angular/core";
import {
  ɵCOPILOTKIT_ASSISTANT_MARKDOWN_RENDERER,
  ɵCOPILOTKIT_BUILT_IN_ACTIVITY_RENDERERS,
} from "@copilotkit/angular";
import { generativeUIActivityRenderers } from "./chat";
import { GENERATIVE_UI_CONFIG } from "./config";
import type { GenerativeUIConfig } from "./config";
import { CopilotGenerativeUI } from "./generative-ui";
import { CopilotGenerativeUIMarkdownSurfaces } from "./markdown-surfaces";
import { GENERATIVE_UI_RUNTIME } from "./runtime";

/**
 * Experimental. Native generative UI for the app: the agent renders the
 * components of `ui` in the chat and in `<copilot-generative-ui-surface>`
 * targets. Add it to the application providers, next to
 * `provideCopilotKit`. It must be at the root: the chat resolves its
 * renderers from the root injector.
 *
 * @example
 * ```ts
 * bootstrapApplication(App, {
 *   providers: [
 *     provideCopilotKit({ runtimeUrl: "/api/copilotkit" }),
 *     provideGenerativeUI({ ui: standardUI }),
 *   ],
 * });
 * ```
 */
export function provideGenerativeUI(
  config: GenerativeUIConfig,
): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: GENERATIVE_UI_CONFIG, useValue: config },
    { provide: GENERATIVE_UI_RUNTIME, useExisting: CopilotGenerativeUI },
    ...generativeUIActivityRenderers.map((renderer) => ({
      provide: ɵCOPILOTKIT_BUILT_IN_ACTIVITY_RENDERERS,
      multi: true,
      useValue: renderer,
    })),
    // The markdown transport renders the fences of each assistant message as
    // surfaces, unless the app gives the message its own markdown renderer.
    ...(config.transport === "markdown"
      ? [
          {
            provide: ɵCOPILOTKIT_ASSISTANT_MARKDOWN_RENDERER,
            useValue: CopilotGenerativeUIMarkdownSurfaces,
          },
        ]
      : []),
    // The envelope is advertised before the first run.
    provideEnvironmentInitializer(() => inject(CopilotGenerativeUI).start()),
  ]);
}
