import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  inject,
  input,
  output,
  viewChild,
} from "@angular/core";
import type {
  A2UIClientEventMessage,
  Catalog,
  LitComponentImplementation,
  LitRenderable,
} from "@copilotkit/a2ui-renderer/web-components";
import { isComponentType } from "../../slots/slot.utils";
import type { A2UISurfaceError } from "./native-catalog";

/** The `<cpk-a2ui-surface>` properties this component sets. */
type LitSurfaceElement = HTMLElement & {
  operations: readonly unknown[];
  catalog?: Catalog<LitComponentImplementation>;
  theme?: Record<string, unknown>;
  loadingComponent?: () => LitRenderable;
  updateComplete?: Promise<boolean>;
};

let definePromise: Promise<void> | undefined;

/** Loads and defines the Lit web components once; inert without custom elements (SSR). */
export function defineA2UIWebComponentsOnce(): Promise<void> {
  if (typeof globalThis.customElements === "undefined") {
    return Promise.resolve();
  }
  definePromise ??=
    import("@copilotkit/a2ui-renderer/web-components/define").then(
      async (mod) => {
        mod.defineA2UIWebComponents();
        await customElements.whenDefined("cpk-a2ui-surface");
        await Promise.resolve();
      },
    );
  return definePromise;
}

/** Drops loading components the Lit renderer cannot use. */
export function toLitA2UILoadingComponent(
  value: unknown,
): (() => LitRenderable) | undefined {
  return typeof value === "function" && !isComponentType(value)
    ? (value as () => LitRenderable)
    : undefined;
}

/** @internal Renders operations with the Lit web components. */
@Component({
  selector: "copilot-a2ui-lit-surface",
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  host: { style: "display: contents" },
  template: `
    <cpk-a2ui-surface
      #surface
      class="copilot-a2ui-surface-scroll-surface"
      (a2ui-action)="onAction($event)"
      (a2ui-error)="onError($event)"
    ></cpk-a2ui-surface>
  `,
})
export class CopilotA2UILitSurface {
  readonly operations = input<readonly unknown[]>([]);
  /** The outlet only mounts this surface for Lit catalogs. */
  readonly catalog = input<Catalog<LitComponentImplementation>>();
  readonly theme = input<Record<string, unknown>>();
  readonly loadingComponent = input<(() => LitRenderable) | undefined, unknown>(
    undefined,
    { transform: toLitA2UILoadingComponent },
  );

  readonly action = output<A2UIClientEventMessage>();
  readonly error = output<A2UISurfaceError>();
  readonly rendered = output<void>();

  private readonly surface =
    viewChild.required<ElementRef<LitSurfaceElement>>("surface");

  constructor() {
    const canRender = typeof globalThis.customElements !== "undefined";
    let destroyed = false;
    inject(DestroyRef).onDestroy(() => (destroyed = true));

    // Also runs once the elements are defined: `updateComplete`, which
    // `rendered` waits for, only exists from then on.
    const sync = (): void => {
      if (destroyed) return;
      const element = this.surface().nativeElement;
      Object.assign(element, {
        operations: this.operations(),
        catalog: this.catalog(),
        theme: this.theme(),
        loadingComponent: this.loadingComponent(),
      });
      if (!canRender) return;
      void (element.updateComplete ?? Promise.resolve()).then(() => {
        if (!destroyed) this.rendered.emit();
      });
    };

    if (canRender) {
      void defineA2UIWebComponentsOnce().then(sync, (error: unknown) =>
        console.error("[A2UI Angular] failed to load the renderer:", error),
      );
    }
    afterRenderEffect({ write: sync });
  }

  protected onAction(event: Event): void {
    this.action.emit((event as CustomEvent<A2UIClientEventMessage>).detail);
  }

  protected onError(event: Event): void {
    const detail = (event as CustomEvent<Partial<A2UISurfaceError>>).detail;
    this.error.emit({
      error: detail?.error,
      message:
        typeof detail?.message === "string" ? detail.message : String(detail),
    });
  }
}
