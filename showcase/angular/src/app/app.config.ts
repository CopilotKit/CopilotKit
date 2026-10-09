import type { ApplicationConfig } from "@angular/core";
import { provideRouter, withComponentInputBinding } from "@angular/router";
import {
  provideCopilotChatConfiguration,
  provideCopilotKit,
} from "@copilotkit/angular";

import frontendCatalogData from "./generated/frontend-catalog.json";
import { routes } from "./app.routes";
import { isDefaultToolRenderingCell, resolveBrowserCell } from "./cell-context";
import type { BrowserCellCatalog } from "./cell-context";
import { a2uiConfigForFeature } from "./features/a2ui/a2ui-catalogs";
import { openGenerativeUIConfigForFeature } from "./features/generated-ui/open-generative-ui-config";
import { suggestionsConfigForFeature } from "./feature-suggestions";

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
      defaultToolRendering:
        cell.kind === "runnable" && isDefaultToolRenderingCell(cell.feature),
      a2ui:
        cell.kind === "runnable"
          ? a2uiConfigForFeature(cell.feature)
          : undefined,
      openGenerativeUI:
        cell.kind === "runnable"
          ? openGenerativeUIConfigForFeature(cell.feature)
          : undefined,
      suggestionsConfig:
        cell.kind === "runnable"
          ? suggestionsConfigForFeature(cell.feature)
          : [],
      licenseKey: "ck_pub_00000000000000000000000000000000",
    }),
    ...provideCopilotChatConfiguration(),
  ],
};
