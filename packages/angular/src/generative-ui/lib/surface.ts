import {
  Component,
  ElementRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  input,
  isDevMode,
  untracked,
  viewChild,
} from "@angular/core";
import { isPlatformBrowser } from "@angular/common";
import {
  allowedComponents,
  scrollToSurface,
} from "@copilotkit/core/generative-ui";
import type { GenerativeUI, GenerativeUIComponentName } from "./catalog";
import { GENERATIVE_UI_RUNTIME } from "./runtime";
import { CopilotGenerativeUISurfaceView } from "./surface-view";

/**
 * Experimental. A named place on the page where the agent can render UI.
 * The content is the fallback, shown until a surface targets this id.
 *
 * @example
 * ```html
 * <copilot-generative-ui-surface
 *   id="products"
 *   [ui]="storeUI"
 *   description="The product list. Show the products that the user asks for."
 *   [components]="['ProductRow', 'ProductCard']"
 * >
 *   <app-featured-products />
 * </copilot-generative-ui-surface>
 * ```
 */
@Component({
  selector: "copilot-generative-ui-surface",
  imports: [CopilotGenerativeUISurfaceView],
  template: `
    @if (surface(); as surface) {
      <div #element [attr.data-generative-ui-surface]="id()">
        <copilot-generative-ui-surface-view [surface]="surface" />
      </div>
    } @else {
      <ng-content />
    }
  `,
  host: { style: "display: block" },
})
export class CopilotGenerativeUISurface<
  UI extends GenerativeUI<any> = GenerativeUI<any>,
> {
  /** Target id the agent renders into. */
  readonly id = input.required<string>();
  /**
   * Tells the model where this surface is and what to show in it, for
   * example "Next to the product list. Use it for product recommendations."
   */
  readonly description = input<string>();
  /**
   * The UI of the provider (`provideGenerativeUI({ ui })`). It types the
   * names in `components`.
   */
  readonly ui = input<UI>();
  /**
   * The only components that the agent can use in this surface, the root
   * included. The agent gets the list, and an operation with another
   * component is rejected. Left out, every component of the UI is allowed.
   */
  readonly components = input<readonly GenerativeUIComponentName<UI>[]>();
  /**
   * Scrolls the page to this surface when the agent starts to render into
   * it, unless the surface is already on screen. With a sticky header, give
   * the surface a `scroll-margin-top`
   * (`[data-generative-ui-surface] { scroll-margin-top: 5rem }`).
   */
  readonly autoScroll = input(true);

  readonly #runtime = inject(GENERATIVE_UI_RUNTIME);
  readonly #isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  protected readonly element = viewChild<ElementRef<HTMLElement>>("element");
  #warnedKey: string | undefined;

  protected readonly surface = computed(() => {
    this.#runtime.version();
    return this.#runtime.manager.getSurfaceForTarget(this.id());
  });

  constructor() {
    // The agent renders only the components of the provider's UI, so the
    // names are checked against it. A different `ui` is a setup mistake.
    effect(() => {
      const ui = this.ui();
      const id = this.id();
      if (ui !== undefined && ui !== this.#runtime.ui && isDevMode()) {
        console.warn(
          `[generativeUI] <copilot-generative-ui-surface id="${id}">: the ui input is not the UI of the provider (provideGenerativeUI({ ui })). The components are checked against the UI of the provider.`,
        );
      }
    });
    effect((onCleanup) => {
      const id = this.id();
      const description = this.description();
      const requested = this.components();
      // A new array with the same names must not register the target again.
      const componentsKey =
        requested === undefined ? undefined : JSON.stringify(requested);
      const unregister = untracked(() => {
        const allowed =
          componentsKey === undefined
            ? undefined
            : allowedComponents(JSON.parse(componentsKey), this.#runtime.ui);
        if (
          allowed !== undefined &&
          allowed.warning !== "" &&
          this.#warnedKey !== componentsKey &&
          isDevMode()
        ) {
          this.#warnedKey = componentsKey;
          console.warn(
            `[generativeUI] <copilot-generative-ui-surface id="${id}">: ${allowed.warning}.`,
          );
        }
        return this.#runtime.manager.registerTarget(id, {
          description,
          components: allowed?.names,
        });
      });
      onCleanup(unregister);
    });
    // Every render_ui call (and every streaming markdown fence) sets the
    // status to "streaming", for a new surface and for an update. The key
    // is set only while the surface streams, so each start scrolls once.
    // The manager changes the status of a surface in place, so the status
    // is read on every notification, not through the `surface` computed.
    const generatingKey = computed(() => {
      this.#runtime.version();
      const surface = this.#runtime.manager.getSurfaceForTarget(this.id());
      return surface?.status === "streaming" ? surface.key : undefined;
    });
    effect(() => {
      const key = generatingKey();
      const element = this.element()?.nativeElement;
      if (this.autoScroll() && key && element && this.#isBrowser) {
        untracked(() => scrollToSurface(element));
      }
    });
  }
}
