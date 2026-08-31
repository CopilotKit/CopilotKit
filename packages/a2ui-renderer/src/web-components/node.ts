import { html, LitElement, nothing } from "lit";
import { ComponentContext } from "@a2ui/web_core/v0_9";
import type { SurfaceModel } from "@a2ui/web_core/v0_9";
import type { LitComponentImplementation } from "./types";

type SubscriptionLike = { unsubscribe: () => void };

export class CpkA2uiNode extends LitElement {
  static properties = {
    surface: { attribute: false },
    componentId: { attribute: false },
    basePath: { attribute: false },
  };

  surface?: SurfaceModel<LitComponentImplementation>;
  componentId = "root";
  basePath = "/";
  private subscriptions: SubscriptionLike[] = [];
  private subscribedSurface?: SurfaceModel<LitComponentImplementation>;
  private subscribedComponentId?: string;

  protected createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.style.display = "contents";
  }

  disconnectedCallback(): void {
    this.unsubscribe();
    super.disconnectedCallback();
  }

  private unsubscribe(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions = [];
    this.subscribedSurface = undefined;
    this.subscribedComponentId = undefined;
  }

  private ensureSubscriptions(): void {
    if (!this.surface) return;
    if (
      this.subscribedSurface === this.surface &&
      this.subscribedComponentId === this.componentId
    ) {
      return;
    }

    this.unsubscribe();
    this.subscribedSurface = this.surface;
    this.subscribedComponentId = this.componentId;
    this.subscriptions.push(
      this.surface.componentsModel.onCreated.subscribe((comp) => {
        if (comp.id === this.componentId) this.requestUpdate();
      }),
      this.surface.componentsModel.onDeleted.subscribe((id) => {
        if (id === this.componentId) this.requestUpdate();
      }),
    );
  }

  render() {
    this.ensureSubscriptions();
    const surface = this.surface;
    if (!surface) return nothing;

    const componentModel = surface.componentsModel.get(this.componentId);
    if (!componentModel) {
      return html`
        <div
          style="
            padding: 12px 16px;
            border-radius: 8px;
            background: linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%);
            background-size: 200% 100%;
            animation: a2ui-shimmer 1.5s ease-in-out infinite;
            min-height: 2rem;
          "
        >
          <style>
            @keyframes a2ui-shimmer {
              0% {
                background-position: 200% 0;
              }
              100% {
                background-position: -200% 0;
              }
            }
          </style>
        </div>
      `;
    }

    const compImpl = surface.catalog.components.get(componentModel.type);
    if (!compImpl) {
      return html`
        <div style="color: red;">Unknown component: ${componentModel.type}</div>
      `;
    }

    const context = new ComponentContext(
      surface,
      this.componentId,
      this.basePath,
    );
    const buildChild = (childId: string, specificPath?: string) => html`
      <cpk-a2ui-node
        .surface=${surface}
        .componentId=${childId}
        .basePath=${specificPath || context.dataContext.path}
      ></cpk-a2ui-node>
    `;

    return compImpl.render(context, buildChild);
  }
}
