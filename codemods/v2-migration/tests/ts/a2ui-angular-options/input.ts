import { bootstrapApplication } from "@angular/platform-browser";
import { provideCopilotKit } from "@copilotkit/angular";
import { App } from "./app";
import { appUI, myTheme } from "./app-ui";

bootstrapApplication(App, {
  providers: [provideCopilotKit({ runtimeUrl: "/api/copilotkit", a2ui: { catalog: appUI, theme: myTheme } })],
});

export const noCatalog = [
  provideCopilotKit({
    runtimeUrl: "/api/copilotkit",
    a2ui: { theme: myTheme },
  }),
];
