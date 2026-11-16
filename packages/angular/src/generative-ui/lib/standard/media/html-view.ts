import { Component, computed, inject, input } from "@angular/core";
import { DomSanitizer } from "@angular/platform-browser";
import {
  backgroundColor,
  borderColor,
  radius,
} from "@copilotkit/shared/generative-ui";
import { px } from "../style";
import type { StyleMap } from "../style";

/**
 * Raw HTML in a fully sandboxed iframe: an empty `sandbox` means no scripts,
 * no same origin, no forms, no popups. The sandbox is the protection, so the
 * HTML is set as the model sent it, not through Angular's sanitizer.
 */
@Component({
  selector: "iframe[copilotGenerativeUIHtmlView]",
  template: "",
  host: {
    sandbox: "",
    "[srcdoc]": "document()",
    "[attr.title]": "title() ?? 'HTML content'",
    "[style]": "style()",
  },
})
export class CopilotGenerativeUIHtmlView {
  readonly html = input<string>();
  readonly height = input<number | string>();
  readonly width = input<number | string>();
  readonly title = input<string>();

  readonly #sanitizer = inject(DomSanitizer);
  protected readonly document = computed(() =>
    this.#sanitizer.bypassSecurityTrustHtml(this.html() ?? ""),
  );
  protected readonly style = computed<StyleMap>(() => ({
    display: "block",
    border: `1px solid ${borderColor("default")}`,
    borderRadius: radius("md"),
    height: px(this.height() ?? 360),
    width: px(this.width() ?? "100%"),
    background: backgroundColor("surface"),
  }));
}
