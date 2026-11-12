import { bootstrapApplication } from "@angular/platform-browser";
import { provideCopilotKit } from "@copilotkit/angular";
import { App } from "./app";
import { appUI, myTheme } from "./app-ui";
import { provideGenerativeUI } from "@copilotkit/angular/generative-ui";

bootstrapApplication(App, {
  providers: [provideCopilotKit({ runtimeUrl: "/api/copilotkit", /* TODO(copilotkit-2.0): The `a2ui` option was removed in 2.0, and these options have no 1:1 equivalent: `theme` becomes the `theme` of the generative UI config (CSS variables), `onAction` becomes events or functions on the components, and `loadingComponent`, `recovery` and `includeSchema` are gone. Move what you need, then delete `a2ui`. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui */ a2ui: { theme: myTheme } }), provideGenerativeUI({ ui: appUI })],
});

export const noCatalog = [
  provideCopilotKit({
    runtimeUrl: "/api/copilotkit",
    // TODO(copilotkit-2.0): The `a2ui` option was removed in 2.0, and these options have no 1:1 equivalent: `theme` becomes the `theme` of the generative UI config (CSS variables), `onAction` becomes events or functions on the components, and `loadingComponent`, `recovery` and `includeSchema` are gone. Move what you need, then delete `a2ui`. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui
    a2ui: { theme: myTheme },
  }),
];
