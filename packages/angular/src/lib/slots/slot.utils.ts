import {
  Binding,
  ComponentRef,
  EmbeddedViewRef,
  TemplateRef,
  Type,
  ViewContainerRef,
  inject,
  inputBinding,
  outputBinding,
  reflectComponentType,
} from "@angular/core";
import {
  SlotValue,
  SlotOutputs,
  RenderSlotOptions,
  SlotRegistryEntry,
  SLOT_CONFIG,
} from "./slot.types";

/**
 * Returns the component inputs that should be bound for the current context.
 *
 * Context keys are matched against public (template) input names so unknown
 * keys are ignored without overwriting defaults for omitted inputs. A `props`
 * input retains the legacy aggregate-context behavior.
 */
export function slotInputNames(
  type: Type<unknown>,
  context: unknown,
): string[] {
  const mirror = reflectComponentType(type);
  if (!mirror) return [];

  if (
    context != null &&
    mirror.inputs.some(({ templateName }) => templateName === "props")
  ) {
    return ["props"];
  }

  const contextKeys = new Set(
    Object.keys((context as Record<string, unknown> | undefined) ?? {}),
  );
  return mirror.inputs
    .filter(({ templateName }) => contextKeys.has(templateName))
    .map(({ templateName }) => templateName);
}

/**
 * Builds `createComponent` bindings for a slot component.
 *
 * The input-name set is fixed for the lifetime of the component; callers must
 * recreate the component when {@link slotInputNames} changes. Input values and
 * output handlers remain live through their getters. Every declared output is
 * bound so handlers can be added, replaced, or removed without recreation.
 */
export function slotBindings(
  type: Type<unknown>,
  inputNames: readonly string[],
  context: () => unknown,
  outputs: () => SlotOutputs | undefined,
): Binding[] {
  const mirror = reflectComponentType(type);
  if (!mirror) return [];
  const values = () => context() as Record<string, unknown> | undefined;
  return [
    ...inputNames.map((templateName) =>
      inputBinding(templateName, () =>
        templateName === "props" ? context() : values()?.[templateName],
      ),
    ),
    ...mirror.outputs.map(({ templateName }) =>
      outputBinding(templateName, (event) =>
        outputs()?.[templateName]?.(event),
      ),
    ),
  ];
}

/**
 * Renders a slot value into a ViewContainerRef.
 *
 * Templates receive `{ $implicit: props, props }` as their context. Components
 * get individual `props` keys bound to matching inputs, or the entire object
 * when the component declares a `props` input. `outputs` are matched by public
 * name via {@link slotBindings}; bindings are applied on the next change
 * detection pass.
 *
 * @param viewContainer - The ViewContainerRef to render into
 * @param options - Options for rendering the slot
 * @returns The created component or embedded view reference
 *
 * @example
 * ```typescript
 * export class MyComponent {
 *   @ViewChild('container', { read: ViewContainerRef }) container!: ViewContainerRef;
 *
 *   renderButton() {
 *     renderSlot(this.container, {
 *       slot: this.buttonOverride,
 *       defaultComponent: DefaultButton,
 *       props: { text: 'Click me' },
 *       outputs: { click: (event) => this.handleClick(event) }
 *     });
 *   }
 * }
 * ```
 */
export function renderSlot<T = any>(
  viewContainer: ViewContainerRef,
  options: RenderSlotOptions<T>,
): ComponentRef<T> | EmbeddedViewRef<T> {
  const { slot, defaultComponent, props, injector, outputs } = options;

  viewContainer.clear();

  const effectiveSlot = slot ?? defaultComponent;

  if (effectiveSlot instanceof TemplateRef) {
    return viewContainer.createEmbeddedView(effectiveSlot, {
      $implicit: props ?? {},
      props: props ?? {},
    } as any);
  }

  return viewContainer.createComponent(effectiveSlot, {
    injector: injector ?? viewContainer.injector,
    bindings: slotBindings(
      effectiveSlot,
      slotInputNames(effectiveSlot, props),
      () => props,
      () => outputs,
    ),
  });
}

/**
 * Checks if a value is an Angular component type.
 */
export function isComponentType(value: unknown): value is Type<unknown> {
  return (
    typeof value === "function" &&
    reflectComponentType(value as Type<unknown>) !== null
  );
}

/**
 * Checks if a value is a valid slot value.
 */
export function isSlotValue(value: unknown): value is SlotValue {
  return value instanceof TemplateRef || isComponentType(value);
}

/**
 * Normalizes a slot value to a consistent format.
 */
export function normalizeSlotValue<T = any>(
  value: SlotValue<T> | undefined,
  defaultComponent: Type<T> | undefined,
): SlotRegistryEntry<T> {
  if (!value) {
    return { component: defaultComponent };
  }

  if (value instanceof TemplateRef) {
    return { template: value };
  }

  if (isComponentType(value)) {
    return { component: value as Type<T> };
  }

  return { component: defaultComponent };
}

/**
 * Creates a slot configuration map for a component.
 *
 * @example
 * ```typescript
 * const slots = createSlotConfig({
 *   sendButton: CustomSendButton,
 *   toolbar: 'custom-toolbar-class',
 *   footer: footerTemplate
 * }, {
 *   sendButton: DefaultSendButton,
 *   toolbar: DefaultToolbar,
 *   footer: DefaultFooter
 * });
 * ```
 */
export function createSlotConfig<T extends Record<string, Type<any>>>(
  overrides: Partial<Record<keyof T, SlotValue>>,
  defaults: T,
): Map<keyof T, SlotRegistryEntry> {
  const config = new Map<keyof T, SlotRegistryEntry>();

  for (const key in defaults) {
    const override = overrides[key];
    const defaultComponent = defaults[key];
    config.set(key, normalizeSlotValue(override, defaultComponent));
  }

  return config;
}

/**
 * Provides slot configuration to child components via DI.
 *
 * @example
 * ```typescript
 * @Component({
 *   providers: [
 *     provideSlots({
 *       sendButton: CustomSendButton,
 *       toolbar: CustomToolbar
 *     })
 *   ]
 * })
 * ```
 */
export function provideSlots(slots: Record<string, Type<any>>) {
  const slotMap = new Map<string, SlotRegistryEntry>();

  // Only accept component types in DI (templates lack view context)
  for (const [key, value] of Object.entries(slots)) {
    if (isComponentType(value)) {
      slotMap.set(key, { component: value as Type<any> });
    }
  }

  return {
    provide: SLOT_CONFIG,
    useValue: slotMap,
  };
}

/**
 * Gets slot configuration from DI.
 * Must be called within an injection context.
 *
 * @example
 * ```typescript
 * export class MyComponent {
 *   slots = getSlotConfig();
 *
 *   ngOnInit() {
 *     const sendButton = this.slots?.get('sendButton');
 *   }
 * }
 * ```
 */
export function getSlotConfig(): ReadonlyMap<string, SlotRegistryEntry> | null {
  return inject(SLOT_CONFIG, { optional: true });
}

/**
 * Creates a render function for a specific slot.
 * Useful for creating reusable slot renderers.
 *
 * @example
 * ```typescript
 * const renderSendButton = createSlotRenderer(
 *   DefaultSendButton,
 *   'sendButton'
 * );
 *
 * // Later in template
 * renderSendButton(this.viewContainer, this.sendButtonOverride);
 * ```
 */
export function createSlotRenderer<T>(
  defaultComponent: Type<T>,
  slotName?: string,
) {
  // Get config in the injection context when the renderer is created
  const config = slotName ? getSlotConfig() : null;

  return (
    viewContainer: ViewContainerRef,
    slot?: SlotValue<T>,
    props?: Partial<T>,
    outputs?: SlotOutputs,
  ) => {
    // Check DI for overrides if slot name provided
    if (slotName && !slot && config) {
      const entry = config.get(slotName);
      if (entry) {
        if (entry.component) slot = entry.component;
        else if (entry.template) slot = entry.template;
      }
    }

    return renderSlot(viewContainer, {
      slot,
      defaultComponent,
      props,
      outputs,
    });
  };
}
