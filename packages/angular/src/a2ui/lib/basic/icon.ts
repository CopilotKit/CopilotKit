import { Component, computed } from "@angular/core";
import { IconApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { CopilotA2UIBasicComponent } from "./basic-component";

/** Renders a Material Symbols ligature; the app loads the icon font. */
@Component({
  selector: "copilot-a2ui-icon",
  template: `
    <span class="material-symbols-outlined icon">{{ name() }}</span>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    .icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--a2ui-icon-size, 24px);
      height: var(--a2ui-icon-size, 24px);
      box-sizing: border-box;
      font-size: var(--a2ui-icon-size, 24px);
    }
  `,
})
export class CopilotA2UIIcon extends CopilotA2UIBasicComponent<typeof IconApi> {
  protected readonly name = computed(() => {
    const name: unknown = this.props().name;
    return typeof name === "string"
      ? name
      : (name as { path?: string } | undefined)?.path;
  });
}
