import {
  Component,
  InjectionToken,
  Injector,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  type WritableSignal,
} from "@angular/core";
import {
  ComponentContext,
  GenericBinder,
  scrapeSchemaBehavior,
  type BehaviorNode,
  type SurfaceModel,
} from "@a2ui/web_core/v0_9";
import { CopilotSlot } from "@copilotkit/angular";
import { normalizeChildRefs } from "./child-ref";
import {
  A2UI_COMPONENT_CONTEXT,
  createA2UIComponentContext,
} from "./component-context";
import type { CopilotA2UIComponentImplementation } from "./types";

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
 * binding the binder-resolved props as a slot would.
 */
@Component({
  selector: "copilot-a2ui-node",
  imports: [CopilotSlot],
  host: { style: "display: contents" },
  template: `
    @if (model(); as model) {
      @if (implementation(); as implementation) {
        <copilot-slot
          style="display: contents"
          [slot]="implementation.component"
          [context]="props()"
          [injector]="injector()"
        />
      } @else {
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
  readonly surface =
    input.required<SurfaceModel<CopilotA2UIComponentImplementation>>();
  readonly componentId = input.required<string>();
  readonly basePath = input("/");

  private readonly parentInjector = inject(Injector);
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
    effect((onCleanup) => {
      const context = this.componentContext();
      const implementation = this.implementation();
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
