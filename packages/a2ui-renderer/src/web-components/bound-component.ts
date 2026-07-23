import { LitElement, nothing } from "lit";
import { GenericBinder } from "@a2ui/web_core/v0_9";
import type { ComponentApi, ComponentContext } from "@a2ui/web_core/v0_9";
import type { LitRenderable, LitRendererFn } from "./types";

export class CpkA2uiBoundComponent extends LitElement {
  static properties = {
    api: { attribute: false },
    context: { attribute: false },
    buildChild: { attribute: false },
    renderFn: { attribute: false },
    setupState: { attribute: false },
  };

  api?: ComponentApi;
  context?: ComponentContext;
  buildChild?: (id: string, basePath?: string) => LitRenderable;
  renderFn?: LitRendererFn<any, any>;
  setupState?: () => unknown;

  private binder: GenericBinder<any> | null = null;
  private binderContext: ComponentContext | null = null;
  private propsSnapshot: Record<string, unknown> = {};
  private stateInitialized = false;
  private state: unknown;

  protected createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.style.display = "contents";
  }

  disconnectedCallback(): void {
    this.disposeBinder();
    super.disconnectedCallback();
  }

  private disposeBinder(): void {
    this.binder?.dispose();
    this.binder = null;
    this.binderContext = null;
  }

  private ensureBinder(): void {
    if (!this.api || !this.context) return;
    if (this.binder && this.binderContext === this.context) return;

    this.disposeBinder();
    this.binderContext = this.context;
    this.binder = new GenericBinder(this.context, this.api.schema);
    this.propsSnapshot = this.binder.snapshot ?? {};
    this.binder.subscribe((props) => {
      this.propsSnapshot = props ?? {};
      this.requestUpdate();
    });
  }

  private ensureState(): void {
    if (this.stateInitialized) return;
    this.stateInitialized = true;
    this.state = this.setupState?.();
  }

  render() {
    this.ensureBinder();
    this.ensureState();
    if (!this.renderFn || !this.context || !this.buildChild) return nothing;
    return this.renderFn({
      props: this.propsSnapshot,
      buildChild: this.buildChild,
      context: this.context,
      state: this.state,
      requestUpdate: () => this.requestUpdate(),
    });
  }
}
