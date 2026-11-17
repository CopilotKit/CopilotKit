import { DOCUMENT } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  InjectionToken,
  ViewEncapsulation,
  afterNextRender,
  inject,
  isDevMode,
} from "@angular/core";
import { ɵwarnIfStylesOverridden } from "@copilotkit/core/styles";
import { COPILOT_KIT_CONFIG } from "../config";
// Generated from @copilotkit/core/styles before build, test and type checking.
import { stylesheet } from "./stylesheet";

/**
 * Injection token that reports whether `<copilot-kit-styles>` checks the page
 * for CSS that overrides CopilotKit's styles. Tests can override it.
 * Applications must not depend on it.
 *
 * @internal
 */
export const ɵCOPILOTKIT_STYLES_DEVELOPMENT_MODE = new InjectionToken<boolean>(
  "CopilotKit styles development mode",
  { factory: isDevMode },
);

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
 *
 * In development, it warns in the console when the app's CSS overrides these
 * styles, such as a global reset outside a cascade layer.
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

  constructor() {
    const document = inject(DOCUMENT);
    const checksOverrides =
      this.enabled && inject(ɵCOPILOTKIT_STYLES_DEVELOPMENT_MODE);
    if (checksOverrides) {
      // Runs only in the browser, after the stylesheet is in <head>.
      afterNextRender(() => ɵwarnIfStylesOverridden(document));
    }
  }
}
