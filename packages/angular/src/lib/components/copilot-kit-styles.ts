import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  inject,
} from "@angular/core";
import { COPILOT_KIT_CONFIG } from "../config";
// Generated from @copilotkit/core/styles before build, test and type checking.
import { stylesheet } from "./stylesheet";

/**
 * Holds the stylesheet. Angular adds a component's styles to `<head>` once,
 * however many instances render, inlines them in server-rendered HTML, and
 * gives the tag the `CSP_NONCE` nonce.
 */
@Component({
  selector: "copilot-kit-stylesheet",
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { hidden: "" },
  template: "",
  styles: [stylesheet],
})
class CopilotKitStylesheet {}

/**
 * Adds the CSS for CopilotKit's UI to the page, so apps never import a
 * stylesheet. `<copilot-chat>`, `<copilot-chat-view>`, `<copilot-popup>` and
 * `<copilot-sidebar>` render it for you. Render `<copilot-kit-styles />`
 * yourself only when you build a layout from the chat parts without them.
 *
 * Adds nothing when `provideCopilotKit` has `injectStyles: false`.
 */
@Component({
  selector: "copilot-kit-styles",
  imports: [CopilotKitStylesheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { hidden: "" },
  template: `
    @if (enabled) {
      <copilot-kit-stylesheet />
    }
  `,
})
export class CopilotKitStyles {
  protected readonly enabled =
    inject(COPILOT_KIT_CONFIG, { optional: true })?.injectStyles !== false;
}
