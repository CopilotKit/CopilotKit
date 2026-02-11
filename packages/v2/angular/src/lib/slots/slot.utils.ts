import {
  Type,
  TemplateRef,
  ViewContainerRef,
  ComponentRef,
  EmbeddedViewRef,
  Injector,
  inject,
} from "@angular/core";
import {
  SlotValue,
  RenderSlotOptions,
  SlotRegistryEntry,
  SLOT_CONFIG,
} from "./slot.types";

/**
 * Renders a slot value into a ViewContainerRef.
 * This is the core utility for slot rendering.
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
  options: RenderSlotOptions<T>
): ComponentRef<T> | EmbeddedViewRef<T> | null {
  const { slot, defaultComponent, props, injector, outputs } = options;

  viewContainer.clear();

  const effectiveSlot = slot ?? defaultComponent;
  const effectiveInjector = injector ?? viewContainer.injector;

  if (effectiveSlot instanceof TemplateRef) {
    // TemplateRef: render template
    return viewContainer.createEmbeddedView(effectiveSlot, {
      $implicit: props ?? {},
      props: props ?? {},
    } as any);
  } else if (isComponentType(effectiveSlot)) {
    // Component type - wrap in try/catch for safety
    try {
      return createComponent(
        viewContainer,
        effectiveSlot as Type<T>,
        props,
        effectiveInjector,
        outputs
      );
    } catch (error) {
      console.warn("Failed to create component:", effectiveSlot, error);
      // Fall through to default component
    }
  }

  // Default: render default component if provided
  return defaultComponent
    ? createComponent(
        viewContainer,
        defaultComponent,
        props,
        effectiveInjector,
        outputs
      )
    : null;
}

/**
 * Creates a component and applies properties.
 */
function createComponent<T>(
  viewContainer: ViewContainerRef,
  component: Type<T>,
  props?: Partial<T>,
  injector?: Injector,
  outputs?: Record<string, (event: any) => void>
): ComponentRef<T> {
  const componentRef = viewContainer.createComponent(component, {
    injector,
  });

  if (props) {
    // Apply props using setInput, but only for declared inputs
    const cmpDef: any = (component as any).ɵcmp;
    const declaredInputs = new Set<string>(Object.keys(cmpDef?.inputs ?? {}));

    if (declaredInputs.has("props")) {
      componentRef.setInput("props", props as any);
    } else {
      for (const key in props) {
        if (declaredInputs.has(key)) {
          const value = (props as any)[key];
          componentRef.setInput(key, value);
        }
      }
    }
  }

  if (outputs) {
    // Wire up output event handlers with proper cleanup
    const instance = componentRef.instance as any;
    const subscriptions: any[] = [];

    for (const [eventName, handler] of Object.entries(outputs)) {
      if (instance[eventName]?.subscribe) {
        const subscription = instance[eventName].subscribe(handler);
        subscriptions.push(subscription);
      }
    }

    // Register cleanup on component destroy
    componentRef.onDestroy(() => {
      subscriptions.forEach((sub) => sub.unsubscribe());
    });
  }

  // Trigger change detection
  componentRef.changeDetectorRef.detectChanges();

  return componentRef;
}

/**
 * Checks if a value is a component type.
 * Simplified check - rely on try/catch for actual validation.
 */
export function isComponentType(value: any): boolean {
  // Arrow functions and regular functions without a prototype are not components
  return typeof value === "function" && !!value.prototype;
}

/**
 * Checks if a value is a valid slot value.
 */
export function isSlotValue(value: any): value is SlotValue {
  return value instanceof TemplateRef || isComponentType(value);
}

/**
 * Normalizes a slot value to a consistent format.
 */
export function normalizeSlotValue<T = any>(
  value: SlotValue<T> | undefined,
  defaultComponent: Type<T> | undefined
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
    standalone: true,
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
  defaults: T
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
  standalone: true,
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
  slotName?: string
) {
  // Get config in the injection context when the renderer is created
  const config = slotName ? getSlotConfig() : null;

  return (
    viewContainer: ViewContainerRef,
    slot?: SlotValue<T>,
    props?: Partial<T>,
    outputs?: Record<string, (event: any) => void>
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
