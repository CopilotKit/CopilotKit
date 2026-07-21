import type { ApplicationConfig } from "@angular/core";
import { provideRouter, withComponentInputBinding } from "@angular/router";
import {
  provideCopilotChatConfiguration,
  provideCopilotKit,
} from "@copilotkit/angular";

import frontendCatalogData from "./generated/frontend-catalog.json";
import { routes } from "./app.routes";
import { resolveBrowserCell } from "./cell-context";
import type { BrowserCellCatalog } from "./cell-context";

const browserPath =
  typeof globalThis.location === "undefined"
    ? ""
    : globalThis.location.pathname;
const cell = resolveBrowserCell(
  browserPath,
  frontendCatalogData as BrowserCellCatalog,
);

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withComponentInputBinding()),
    provideCopilotKit({
      runtimeUrl: cell.kind === "runnable" ? cell.runtimeUrl : undefined,
      licenseKey: "ck_pub_00000000000000000000000000000000",
    }),
    ...provideCopilotChatConfiguration(),
  ],
};
