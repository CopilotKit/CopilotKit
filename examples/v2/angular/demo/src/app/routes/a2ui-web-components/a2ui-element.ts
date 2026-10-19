import type { ComponentContext } from "@a2ui/web_core/v0_9";
import { GenericBinder } from "@a2ui/web_core/v0_9";
import type { A2uiWebComponentElement } from "@copilotkit/angular/a2ui";
import type { ZodTypeAny } from "zod";

/**
 * A plain Custom Element base for A2UI catalog entries. The renderer assigns
 * `context`; the element binds its schema to it with web_core's
 * `GenericBinder` and re-renders whenever the resolved props change. Dynamic
 * props come with `set*` setters that write back to the data model.
 */
export abstract class A2uiElement<Props>
  extends HTMLElement
  implements A2uiWebComponentElement
{
  protected abstract readonly schema: ZodTypeAny;
  protected abstract render(props: Props): void;

  #context?: ComponentContext;
  #binder?: GenericBinder<Props>;
  #subscription?: { unsubscribe(): void };

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  get context(): ComponentContext | undefined {
    return this.#context;
  }

  set context(context: ComponentContext | undefined) {
    this.#context = context;
    this.#bind();
  }

  // Angular may move the element (for example when siblings reorder), which
  // disconnects and reconnects it; bind only while it is in the document.
  connectedCallback(): void {
    this.#bind();
  }

  disconnectedCallback(): void {
    this.#unbind();
  }

  #bind(): void {
    this.#unbind();
    if (!this.#context || !this.isConnected) return;
    this.#binder = new GenericBinder<Props>(this.#context, this.schema);
    this.#subscription = this.#binder.subscribe((props) => this.render(props));
    this.render(this.#binder.snapshot);
  }

  #unbind(): void {
    this.#subscription?.unsubscribe();
    this.#subscription = undefined;
    this.#binder?.dispose();
    this.#binder = undefined;
  }
}
