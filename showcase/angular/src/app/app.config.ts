import type { ApplicationConfig, EnvironmentProviders } from "@angular/core";
import { provideRouter, withComponentInputBinding } from "@angular/router";
import {
  provideCopilotChatConfiguration,
  provideCopilotKit,
} from "@copilotkit/angular";

import frontendCatalogData from "./generated/frontend-catalog.json";
import { resolveFeatureComponentKey, routes } from "./app.routes";
import { isDefaultToolRenderingCell, resolveBrowserCell } from "./cell-context";
import type { BrowserCellCatalog } from "./cell-context";
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

/**
 * The generative UI providers of an A2UI cell: its catalog renders the
 * agent's surfaces. Loaded only for those cells, so the other cells do not
 * download the catalogs.
 */
export async function loadGenerativeUIProviders(): Promise<
  EnvironmentProviders[]
> {
  if (cell.kind !== "runnable") return [];
  const key = resolveFeatureComponentKey(cell.feature);
  if (key !== "a2ui" && key !== "beautiful-chat") return [];
  const [{ provideGenerativeUI }, { generativeUIForFeature }] =
    await Promise.all([
      import("@copilotkit/angular/generative-ui"),
      import("./features/a2ui/a2ui-catalogs"),
    ]);
  const ui = generativeUIForFeature(cell.feature);
  return ui ? [provideGenerativeUI({ ui })] : [];
}
