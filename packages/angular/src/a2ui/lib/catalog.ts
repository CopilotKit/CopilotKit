import type { Type } from "@angular/core";
import { Catalog } from "@a2ui/web_core/v0_9";
import type { NativeA2UICatalog } from "@copilotkit/angular";
import { CopilotA2UISurface } from "./surface";
import type { CopilotA2UIComponentImplementation } from "./types";

/**
 * A catalog of Angular components. It carries its own renderer so the main
 * entry point can mount it without importing this one.
 */
export class CopilotA2UICatalog
  extends Catalog<CopilotA2UIComponentImplementation>
  implements NativeA2UICatalog
{
  readonly surfaceComponent: Type<unknown> = CopilotA2UISurface;
}
