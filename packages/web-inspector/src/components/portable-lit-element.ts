import { LitElement } from "lit";

/**
 * Recreates the component styles in whichever document currently owns a
 * child element, including an inspector pop-out window.
 */
export abstract class PortableLitElement extends LitElement {
  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    const elementClass = this.constructor as unknown as {
      elementStyles: readonly (CSSStyleSheet | { cssText: string })[];
      shadowRootOptions: ShadowRootInit;
    };
    const renderRoot =
      this.shadowRoot ?? this.attachShadow(elementClass.shadowRootOptions);

    for (const style of elementClass.elementStyles) {
      const styleElement = this.ownerDocument.createElement("style");
      styleElement.textContent =
        "cssText" in style
          ? style.cssText
          : Array.from(style.cssRules, (rule) => rule.cssText).join("");
      renderRoot.append(styleElement);
    }

    return renderRoot;
  }
}
