import { DOCUMENT, Injectable, inject } from "@angular/core";
import {
  STANDARD_CSS,
  STANDARD_STYLE_ID,
} from "@copilotkit/shared/generative-ui";

/**
 * Adds the stylesheets of generative UI to the document once each: the
 * standard catalog stylesheet and one sheet per theme. On the server,
 * Angular serialises the document head, so the styles ship with the HTML.
 */
@Injectable({ providedIn: "root" })
export class GenerativeUIStyles {
  readonly #document = inject(DOCUMENT);

  /** Adds `<style id>` with `css` to the document head, once. */
  ensure(id: string, css: string): void {
    const document = this.#document;
    if (!document?.head || document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
  }

  /** The stylesheet of the standard components. Every one of them calls it. */
  ensureStandard(): void {
    this.ensure(STANDARD_STYLE_ID, STANDARD_CSS);
  }
}
