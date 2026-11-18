import {
  InjectionToken,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
} from "@angular/core";
import type { EnvironmentProviders } from "@angular/core";
import {
  ɵCOPILOTKIT_A2UI_CONFIG,
  ɵCOPILOTKIT_ASSISTANT_MARKDOWN_RENDERER,
  ɵCOPILOTKIT_BUILT_IN_ACTIVITY_RENDERERS,
  ɵsetA2UIGenerativeUIProviders,
} from "@copilotkit/angular";
import { generativeUIActivityRenderers } from "./chat";
import { GENERATIVE_UI_CONFIG } from "./config";
import type { GenerativeUIConfig } from "./config";
import { CopilotGenerativeUI } from "./generative-ui";
import { CopilotGenerativeUIMarkdownSurfaces } from "./markdown-surfaces";
import { GENERATIVE_UI_RUNTIME } from "./runtime";

/** The config given to `provideGenerativeUI`. */
const APP_GENERATIVE_UI_CONFIG = new InjectionToken<GenerativeUIConfig>(
  "APP_GENERATIVE_UI_CONFIG",
);

/**
 * The config of `provideGenerativeUI`, with the options of the deprecated
 * `a2ui` option of `provideCopilotKit` that it leaves out: `a2ui.catalog` is
 * the `ui` and `a2ui.theme` the `theme`.
 */
function resolveGenerativeUIConfig() {
  const app = inject(APP_GENERATIVE_UI_CONFIG, { optional: true });
  const a2ui = inject(ɵCOPILOTKIT_A2UI_CONFIG, { optional: true });
  if (app && !a2ui) return app;
  const ui = app?.ui ?? a2ui?.catalog;
  if (!ui) {
    throw new Error(
      "Generative UI needs provideGenerativeUI({ ui }) in the application providers.",
    );
  }
  return {
    ...app,
    ui,
    theme: app?.theme ?? a2ui?.theme,
  } satisfies GenerativeUIConfig;
}

/**
 * The providers of generative UI other than the app's config. Both
 * `provideGenerativeUI` and the deprecated `a2ui` option add them, so they
 * give the same result twice: the config comes from one factory, and the
 * root starts once.
 */
function generativeUIProviders(transport: GenerativeUIConfig["transport"]) {
  return [
    { provide: GENERATIVE_UI_CONFIG, useFactory: resolveGenerativeUIConfig },
    { provide: GENERATIVE_UI_RUNTIME, useExisting: CopilotGenerativeUI },
    ...generativeUIActivityRenderers.map((renderer) => ({
      provide: ɵCOPILOTKIT_BUILT_IN_ACTIVITY_RENDERERS,
      multi: true,
      useValue: renderer,
    })),
    // The markdown transport renders the fences of each assistant message as
    // surfaces, unless the app gives the message its own markdown renderer.
    ...(transport === "markdown"
      ? [
          {
            provide: ɵCOPILOTKIT_ASSISTANT_MARKDOWN_RENDERER,
            useValue: CopilotGenerativeUIMarkdownSurfaces,
          },
        ]
      : []),
    // The envelope is advertised before the first run.
    provideEnvironmentInitializer(() => inject(CopilotGenerativeUI).start()),
  ];
}

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
    { provide: APP_GENERATIVE_UI_CONFIG, useValue: config },
    ...generativeUIProviders(config.transport),
  ]);
}

// The deprecated `a2ui` option of `provideCopilotKit` turns generative UI on
// with these providers. `@copilotkit/angular` cannot import this entry, so
// this entry hands them over when it loads.
ɵsetA2UIGenerativeUIProviders(() =>
  makeEnvironmentProviders(generativeUIProviders("tool")),
);
