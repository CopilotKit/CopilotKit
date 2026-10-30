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
  /** The number of surfaces that use each theme sheet. */
  readonly #users = new Map<string, number>();

  /** Adds `<style id>` with `css` to the document head, once. */
  ensure(id: string, css: string): void {
    const document = this.#document;
    if (!document?.head || document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
  }

  /**
   * Adds `<style id>` like {@link ensure}, for one user. The returned
   * function releases it, and the last release removes the element: each
   * theme change makes a new sheet, which would otherwise pile up.
   */
  acquire(id: string, css: string): () => void {
    this.ensure(id, css);
    this.#users.set(id, (this.#users.get(id) ?? 0) + 1);
    return () => {
      const users = (this.#users.get(id) ?? 1) - 1;
      if (users > 0) {
        this.#users.set(id, users);
        return;
      }
      this.#users.delete(id);
      this.#document?.getElementById(id)?.remove();
    };
  }

  /** The stylesheet of the standard components. Every one of them calls it. */
  ensureStandard(): void {
    this.ensure(STANDARD_STYLE_ID, STANDARD_CSS);
  }
}
