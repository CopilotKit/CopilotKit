import type { Routes } from "@angular/router";

export const routes: Routes = [
  {
    // Default landing: redirect the root to the A2UI demo.
    path: "",
    pathMatch: "full",
    redirectTo: "a2ui-demo",
  },
  {
    path: "a2ui-demo",
    title: "A2UI Demo",
    loadComponent: () =>
      import("./routes/a2ui/a2ui-demo.component").then(
        (m) => m.A2UIDemoComponent,
      ),
  },
  {
    path: "headless",
    title: "Headless Chat",
    loadComponent: () =>
      import("./routes/headless/headless-chat.component").then(
        (m) => m.HeadlessChatComponent,
      ),
    // The web inspector is hidden on the headless route.
    data: { inspector: false },
  },
  {
    path: "custom-input",
    title: "Custom Input",
    loadComponent: () =>
      import("./routes/custom-input/custom-input-chat.component").then(
        (m) => m.CustomInputChatComponent,
      ),
  },
  {
    path: "ukg-port",
    title: "UKG Port",
    loadComponent: () =>
      import("./routes/ukg-port/co-pilot-port.component").then(
        (m) => m.CoPilotPortComponent,
      ),
  },
  {
    path: "default",
    title: "Default Chat",
    loadComponent: () =>
      import("./routes/default/default-chat.component").then(
        (m) => m.DefaultChatComponent,
      ),
  },
  {
    // Unknown paths fall back to the default landing (A2UI demo).
    path: "**",
    redirectTo: "a2ui-demo",
  },
];
