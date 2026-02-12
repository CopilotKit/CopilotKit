import { lazy, type ComponentType } from 'react';
import type { Types } from '@a2ui/lit/0.8';
import type { A2UIComponentProps, ComponentLoader, ComponentRegistration } from '../types';

/**
 * Registry for A2UI components. Allows registration of custom components
 * and supports lazy loading for code splitting.
 *
 * @example
 * ```tsx
 * const registry = new ComponentRegistry();
 *
 * // Register a component directly
 * registry.register('Text', { component: Text });
 *
 * // Register with lazy loading
 * registry.register('Modal', {
 *   component: () => import('./components/Modal'),
 *   lazy: true
 * });
 *
 * // Use with A2UIRenderer
 * <A2UIRenderer surfaceId="main" registry={registry} />
 * ```
 */
export class ComponentRegistry {
  private static _instance: ComponentRegistry | null = null;
  private registry = new Map<string, ComponentRegistration>();
  private lazyCache = new Map<string, ComponentType<A2UIComponentProps>>();

  /**
   * Get the singleton instance of the registry.
   * Use this for the default global registry.
   */
  static getInstance(): ComponentRegistry {
    if (!ComponentRegistry._instance) {
      ComponentRegistry._instance = new ComponentRegistry();
    }
    return ComponentRegistry._instance;
  }

  /**
   * Reset the singleton instance.
   * Useful for testing.
   */
  static resetInstance(): void {
    ComponentRegistry._instance = null;
  }

  /**
   * Register a component type.
   *
   * @param type - The A2UI component type name (e.g., 'Text', 'Button')
   * @param registration - The component registration
   */
  register<T extends Types.AnyComponentNode>(
    type: string,
    registration: ComponentRegistration<T>
  ): void {
    this.registry.set(type, registration as unknown as ComponentRegistration);
  }

  /**
   * Unregister a component type.
   *
   * @param type - The component type to unregister
   */
  unregister(type: string): void {
    this.registry.delete(type);
    this.lazyCache.delete(type);
  }

  /**
   * Check if a component type is registered.
   *
   * @param type - The component type to check
   * @returns True if the component is registered
   */
  has(type: string): boolean {
    return this.registry.has(type);
  }

  /**
   * Get a component by type. If the component is registered with lazy loading,
   * returns a React.lazy wrapped component.
   *
   * @param type - The component type to get
   * @returns The React component, or null if not found
   */
  get(type: string): ComponentType<A2UIComponentProps> | null {
    const registration = this.registry.get(type);
    if (!registration) return null;

    // If lazy loading is enabled and the component is a loader function
    if (registration.lazy && typeof registration.component === 'function') {
      // Check cache first
      const cached = this.lazyCache.get(type);
      if (cached) return cached;

      // Create lazy component and cache it
      const lazyComponent = lazy(registration.component as ComponentLoader);
      this.lazyCache.set(type, lazyComponent);
      return lazyComponent;
    }

    return registration.component as ComponentType<A2UIComponentProps>;
  }

  /**
   * Get all registered component types.
   *
   * @returns Array of registered type names
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.registry.keys());
  }

  /**
   * Clear all registrations.
   */
  clear(): void {
    this.registry.clear();
    this.lazyCache.clear();
  }
}
