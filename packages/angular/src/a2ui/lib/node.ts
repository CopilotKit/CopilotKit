import { isPlatformBrowser } from "@angular/common";
import {
  Component,
  DestroyRef,
  ElementRef,
  InjectionToken,
  Injector,
  PLATFORM_ID,
  WritableSignal,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from "@angular/core";
import {
  BehaviorNode,
  ComponentContext,
  GenericBinder,
  SurfaceModel,
  scrapeSchemaBehavior,
} from "@a2ui/web_core/v0_9";
import { CopilotSlot } from "@copilotkit/angular";
import { normalizeChildRefs } from "./child-ref";
import {
  A2UI_COMPONENT_CONTEXT,
  createA2UIComponentContext,
} from "./component-context";
import { CopilotA2UICatalogEntry } from "./types";
import {
  A2uiWebComponentElement,
  isWebComponentImplementation,
  registerUniversalElement,
} from "./universal";

type ResolvedProps = Record<string, unknown>;

/**
 * @internal
 * Bumped by the surface after each processed batch. Nodes read it to
 * re-resolve their model synchronously; web_core delivers model events
 * asynchronously, which is too late for a deterministic render.
 */
export const A2UI_SURFACE_REVISION = new InjectionToken<WritableSignal<number>>(
  "A2UI_SURFACE_REVISION",
);

/**
 * Sets every schema prop missing from the component's current properties to
 * `undefined`: the binder omits props the agent has not sent and keeps
 * removed ones from its previous snapshot. Publishing every schema prop also
 * keeps the bound input names stable, so a streamed prop updates an input
 * instead of recreating the component.
 */
function withCurrentProps(
  resolved: ResolvedProps,
  behavior: BehaviorNode,
  properties: Record<string, unknown>,
): ResolvedProps {
  if (behavior.type !== "OBJECT") return resolved;
  const props = { ...resolved };
  for (const key of Object.keys(behavior.shape)) {
    if (key in properties) continue;
    props[key] = undefined;
    if (key === "checks")
      props["isValid"] = props["validationErrors"] = undefined;
  }
  return props;
}

/**
 * @internal
 * Renders one surface component with its registered Angular component,
 * binding the binder-resolved props as a slot would, or with its Custom
 * Element, which binds itself from the assigned `context`.
 */
@Component({
  selector: "copilot-a2ui-node",
  imports: [CopilotSlot],
  host: { style: "display: contents" },
  template: `
    @if (model(); as model) {
      @if (angularImplementation(); as implementation) {
        <copilot-slot
          style="display: contents"
          [slot]="implementation.component"
          [context]="props()"
          [injector]="injector()"
        />
      } @else if (!implementation()) {
        <div
          class="copilot-a2ui-node-unknown"
          role="alert"
          data-testid="a2ui-node-unknown"
        >
          Unknown component: {{ model.type }}
        </div>
      }
    } @else {
      <div
        class="copilot-a2ui-node-placeholder"
        data-testid="a2ui-node-placeholder"
        aria-hidden="true"
      ></div>
    }
  `,
  styles: `
    .copilot-a2ui-node-placeholder {
      min-height: 2rem;
      padding: 12px 16px;
      border-radius: 8px;
      background: linear-gradient(
        90deg,
        var(--a2ui-color-placeholder, #f3f4f6) 25%,
        var(--a2ui-color-placeholder-highlight, #e5e7eb) 50%,
        var(--a2ui-color-placeholder, #f3f4f6) 75%
      );
      background-size: 200% 100%;
      animation: copilot-a2ui-shimmer 1.5s ease-in-out infinite;
    }
    .copilot-a2ui-node-unknown {
      color: var(--a2ui-color-error, #b91c1c);
    }
    @keyframes copilot-a2ui-shimmer {
      0% {
        background-position: 200% 0;
      }
      100% {
        background-position: -200% 0;
      }
    }
  `,
})
export class CopilotA2UINode {
  readonly surface = input.required<SurfaceModel<CopilotA2UICatalogEntry>>();
  readonly componentId = input.required<string>();
  readonly basePath = input("/");

  private readonly parentInjector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly revision = inject(A2UI_SURFACE_REVISION);
  protected readonly props = signal<ResolvedProps>({});

  protected readonly model = computed(() => {
    this.revision();
    return this.surface().componentsModel.get(this.componentId());
  });

  protected readonly implementation = computed(() => {
    const model = this.model();
    return model
      ? this.surface().catalog.components.get(model.type)
      : undefined;
  });

  /** The implementation when the entry is an Angular component. */
  protected readonly angularImplementation = computed(() => {
    const implementation = this.implementation();
    return implementation && !isWebComponentImplementation(implementation)
      ? implementation
      : undefined;
  });

  private readonly componentContext = computed(() => {
    const model = this.model();
    return model && this.implementation()
      ? new ComponentContext(this.surface(), model.id, this.basePath())
      : undefined;
  });

  /** Derived with the context, so a component never sees a stale one. */
  protected readonly injector = computed(() => {
    const context = this.componentContext();
    return context
      ? Injector.create({
          providers: [
            {
              provide: A2UI_COMPONENT_CONTEXT,
              useValue: createA2UIComponentContext(context, this.surface()),
            },
          ],
          parent: this.parentInjector,
        })
      : this.parentInjector;
  });

  constructor() {
    // Custom Element entries: reuse the element while the tag is unchanged and
    // hand it each new context, as the A2UI Angular renderer does. Elements
    // only render in the browser; a server-rendered one would be duplicated on
    // hydration.
    const isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
    let element: A2uiWebComponentElement | undefined;
    const removeElement = () => {
      element?.remove();
      element = undefined;
    };
    inject(DestroyRef).onDestroy(removeElement);
    effect((onCleanup) => {
      const context = this.componentContext();
      const implementation = this.implementation();
      const surface = this.surface();
      const basePath = this.basePath();
      if (
        !isBrowser ||
        !context ||
        !isWebComponentImplementation(implementation)
      ) {
        untracked(removeElement);
        return;
      }
      // The element's own code runs untracked, so signals it reads cannot
      // re-trigger this effect.
      const target = untracked(() => {
        registerUniversalElement(implementation);
        if (element?.localName !== implementation.tagName) {
          removeElement();
          element = this.host.nativeElement.ownerDocument.createElement(
            implementation.tagName,
          );
          this.host.nativeElement.appendChild(element);
        }
        element.context = context;
        return element;
      });
      // A fresh context per update, like the A2UI renderers, so elements that
      // bind once per assignment still see every change.
      const subscription = context.componentModel.onUpdated.subscribe(
        (model) => {
          target.context = new ComponentContext(surface, model.id, basePath);
        },
      );
      onCleanup(() => subscription.unsubscribe());
    });

    effect((onCleanup) => {
      const context = this.componentContext();
      const implementation = this.angularImplementation();
      if (!context || !implementation) {
        untracked(() => this.props.set({}));
        return;
      }

      const binder = new GenericBinder<ResolvedProps>(
        context,
        implementation.schema,
      );
      const behavior = scrapeSchemaBehavior(implementation.schema);
      const publish = (next: ResolvedProps | undefined) =>
        this.props.set(
          normalizeChildRefs(
            withCurrentProps(
              next ?? {},
              behavior,
              context.componentModel.properties,
            ),
            behavior,
            context.dataContext.path,
          ) as ResolvedProps,
        );
      // Subscribing connects the binder; its snapshot is then current.
      // Unsubscribing the last listener disposes it.
      const subscription = binder.subscribe(publish);
      untracked(() => publish(binder.snapshot));
      onCleanup(() => subscription.unsubscribe());
    });
  }
}
