import { Type, TemplateRef, InjectionToken, Injector } from "@angular/core";

/**
 * Represents a value that can be used as a slot override.
 * Can be a component type or template reference only.
 * @internal - This type is for internal use only
 */
export type SlotValue<T = any> = Type<T> | TemplateRef<T>;

/**
 * Handlers for a slot component's outputs, keyed by the output's public
 * (template) name. Keys that do not match a declared output are ignored.
 */
export type SlotOutputs = Record<string, (event: any) => void>;

/**
 * Configuration for a slot
 * @internal - This interface is for internal use only
 */
export interface SlotConfig<T = any> {
  value?: SlotValue<T>;
  default?: Type<T>;
}

/**
 * Context passed to slot templates
 */
export interface SlotContext<T = any> {
  $implicit: T;
  props?: Partial<T>;
  [key: string]: any;
}

/**
 * Slot registry entry
 * @internal - This interface is for internal use only
 */
export interface SlotRegistryEntry<T = any> {
  component?: Type<T>;
  template?: TemplateRef<T>;
}

/**
 * Options for rendering a slot
 */
export interface RenderSlotOptions<T = any> {
  slot?: SlotValue<T>;
  defaultComponent: Type<T>;
  props?: Partial<T>;
  injector?: Injector;
  outputs?: SlotOutputs;
}

/**
 * Injection token for slot configuration
 */
export const SLOT_CONFIG = new InjectionToken<
  ReadonlyMap<string, SlotRegistryEntry>
>("SLOT_CONFIG");

/**
 * Type for components with slots
 */
export type WithSlots<S extends Record<string, Type<any>>, Rest = object> = {
  [K in keyof S as `${string & K}Component`]?: Type<any>;
} & {
  [K in keyof S as `${string & K}Template`]?: TemplateRef<any>;
} & {
  [K in keyof S as `${string & K}Class`]?: string;
} & Rest;
