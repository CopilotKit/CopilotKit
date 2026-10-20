import { Type } from "@angular/core";
import { Catalog } from "@a2ui/web_core/v0_9";
import { A2UICatalog } from "@copilotkit/angular";
import { CopilotA2UISurface } from "./surface";
import { CopilotA2UICatalogEntry } from "./types";

/**
 * A catalog of Angular components. It carries its own renderer so the main
 * entry point can mount it without importing this one.
 */
export class CopilotA2UICatalog
  extends Catalog<CopilotA2UICatalogEntry>
  implements A2UICatalog
{
  readonly surfaceComponent: Type<unknown> = CopilotA2UISurface;
}
