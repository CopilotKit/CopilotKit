/**
 * Structural CSS styles converted from Lit renderer.
 * Uses .a2ui-surface {} instead of :host {} for non-Shadow DOM usage.
 */
export declare const structuralStyles: string;

/**
 * Component-specific styles that replicate Lit's Shadow DOM scoped CSS.
 * Transforms :host, element selectors, and ::slotted() for Light DOM use.
 */
export declare const componentSpecificStyles: string;

/**
 * Injects A2UI structural styles into the document head.
 * Includes utility classes and React-specific overrides.
 * CSS variables (palette) must be defined by the host on :root.
 */
export declare function injectStyles(): void;

/**
 * Removes the injected A2UI structural styles from the document.
 */
export declare function removeStyles(): void;
