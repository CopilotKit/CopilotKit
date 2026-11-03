import { LitElement } from "lit";

type PortableStyles = Readonly<{
  shadowRootOptions: ShadowRootInit;
  styleTexts: readonly string[];
}>;

const portableStylesByConstructor = new WeakMap<object, PortableStyles>();

/** Keeps style nodes attached when an element moves into the pop-out document. */
export abstract class PortableLitElement extends LitElement {
  protected static override finalize(): void {
    super.finalize();
    portableStylesByConstructor.set(this, {
      shadowRootOptions: this.shadowRootOptions,
      styleTexts: this.elementStyles.map((style) =>
        "cssText" in style
          ? style.cssText
          : Array.from(style.cssRules, (rule) => rule.cssText).join(""),
      ),
    });
  }

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    const definition = portableStylesByConstructor.get(this.constructor);
    const renderRoot =
      this.shadowRoot ??
      this.attachShadow(
        definition?.shadowRootOptions ?? PortableLitElement.shadowRootOptions,
      );

    for (const styleText of definition?.styleTexts ?? []) {
      const styleElement = this.ownerDocument.createElement("style");
      styleElement.textContent = styleText;
      renderRoot.append(styleElement);
    }

    return renderRoot;
  }
}
