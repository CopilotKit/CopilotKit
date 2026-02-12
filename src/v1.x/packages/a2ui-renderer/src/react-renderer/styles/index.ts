import { Styles } from '@a2ui/lit/0.8';
import { resetStyles } from './reset';

/**
 * Structural CSS styles from the Lit renderer, converted for global DOM use.
 * These styles define all the utility classes (layout-*, typography-*, color-*, etc.)
 * Converts :host selectors to .a2ui-surface for scoped use outside Shadow DOM.
 */
export const structuralStyles: string = Styles.structuralStyles.replace(
  /:host\s*\{/g,
  '.a2ui-surface {'
);

/**
 * Component-specific styles that replicate Lit's Shadow DOM scoped CSS.
 *
 * Each Lit component has `static styles` with :host, element selectors, and ::slotted().
 * Since React uses Light DOM, we transform these to global CSS scoped under .a2ui-surface.
 *
 * Transformation rules:
 *   :host          → .a2ui-surface .a2ui-{component}
 *   section        → .a2ui-surface .a2ui-{component} section
 *   ::slotted(*)   → .a2ui-surface .a2ui-{component} section > *
 */
export const componentSpecificStyles: string = `
/* =========================================================================
 * Card (from Lit card.ts static styles)
 * ========================================================================= */

/* :host { display: block; flex: var(--weight); min-height: 0; overflow: auto; } */
.a2ui-surface .a2ui-card {
  display: block;
  flex: var(--weight);
  min-height: 0;
  overflow: auto;
}

/* section { height: 100%; width: 100%; min-height: 0; overflow: auto; } */
/* Use > to target only Card's direct section, not nested sections (e.g., TextField's section) */
.a2ui-surface .a2ui-card > section {
  height: 100%;
  width: 100%;
  min-height: 0;
  overflow: auto;
}

/* section ::slotted(*) { height: 100%; width: 100%; } */
/* Use > section > to only target Card's slotted children, not deeply nested elements */
.a2ui-surface .a2ui-card > section > * {
  height: 100%;
  width: 100%;
}

/* =========================================================================
 * Divider (from Lit divider.ts static styles)
 * ========================================================================= */

/* :host { display: block; min-height: 0; overflow: auto; } */
.a2ui-surface .a2ui-divider {
  display: block;
  min-height: 0;
  overflow: auto;
}

/* hr { height: 1px; background: #ccc; border: none; } */
/* Use :where() for low specificity (0,0,1) so theme utility classes can override */
/* Browser default margins apply (margin-block: 0.5em, margin-inline: auto) */
:where(.a2ui-surface .a2ui-divider) hr {
  height: 1px;
  background: #ccc;
  border: none;
}

/* =========================================================================
 * Text (from Lit text.ts static styles)
 * ========================================================================= */

/* :host { display: block; flex: var(--weight); } */
.a2ui-surface .a2ui-text {
  display: block;
  flex: var(--weight);
}

/* h1, h2, h3, h4, h5 { line-height: inherit; font: inherit; } */
/* Use :where() to match Lit's low specificity (0,0,0,1 - just element) */
:where(.a2ui-surface .a2ui-text) h1,
:where(.a2ui-surface .a2ui-text) h2,
:where(.a2ui-surface .a2ui-text) h3,
:where(.a2ui-surface .a2ui-text) h4,
:where(.a2ui-surface .a2ui-text) h5 {
  line-height: inherit;
  font: inherit;
}

/* Ensure markdown paragraph margins are reset */
.a2ui-surface .a2ui-text p {
  margin: 0;
}

/* =========================================================================
 * TextField (from Lit text-field.ts static styles)
 * ========================================================================= */

/* :host { display: flex; flex: var(--weight); } */
.a2ui-surface .a2ui-textfield {
  display: flex;
  flex: var(--weight);
}

/* input { display: block; width: 100%; } */
:where(.a2ui-surface .a2ui-textfield) input {
  display: block;
  width: 100%;
}

/* label { display: block; margin-bottom: 4px; } */
:where(.a2ui-surface .a2ui-textfield) label {
  display: block;
  margin-bottom: 4px;
}

/* textarea - same styling as input for multiline text fields */
:where(.a2ui-surface .a2ui-textfield) textarea {
  display: block;
  width: 100%;
}

/* =========================================================================
 * CheckBox (from Lit checkbox.ts static styles)
 * ========================================================================= */

/* :host { display: block; flex: var(--weight); min-height: 0; overflow: auto; } */
.a2ui-surface .a2ui-checkbox {
  display: block;
  flex: var(--weight);
  min-height: 0;
  overflow: auto;
}

/* input { display: block; width: 100%; } */
:where(.a2ui-surface .a2ui-checkbox) input {
  display: block;
  width: 100%;
}

/* =========================================================================
 * Slider (from Lit slider.ts static styles)
 * ========================================================================= */

/* :host { display: block; flex: var(--weight); } */
.a2ui-surface .a2ui-slider {
  display: block;
  flex: var(--weight);
}

/* input { display: block; width: 100%; } */
:where(.a2ui-surface .a2ui-slider) input {
  display: block;
  width: 100%;
}

/* =========================================================================
 * Button (from Lit button.ts static styles)
 * ========================================================================= */

/* :host { display: block; flex: var(--weight); min-height: 0; } */
.a2ui-surface .a2ui-button {
  display: block;
  flex: var(--weight);
  min-height: 0;
}

/* =========================================================================
 * Icon (from Lit icon.ts static styles)
 * ========================================================================= */

/* :host { display: block; flex: var(--weight); min-height: 0; overflow: auto; } */
.a2ui-surface .a2ui-icon {
  display: block;
  flex: var(--weight);
  min-height: 0;
  overflow: auto;
}

/* =========================================================================
 * Tabs (from Lit tabs.ts static styles)
 * ========================================================================= */

/* :host { display: block; flex: var(--weight); } */
.a2ui-surface .a2ui-tabs {
  display: block;
  flex: var(--weight);
}

/* =========================================================================
 * Modal (from Lit modal.ts static styles)
 * ========================================================================= */

/* :host { display: block; flex: var(--weight); } */
.a2ui-surface .a2ui-modal {
  display: block;
  flex: var(--weight);
}

/* dialog { padding: 0; border: none; background: none; } */
:where(.a2ui-surface .a2ui-modal) dialog {
  padding: 0;
  border: none;
  background: none;
}

/* dialog section #controls { display: flex; justify-content: end; margin-bottom: 4px; } */
.a2ui-surface .a2ui-modal dialog section #controls {
  display: flex;
  justify-content: end;
  margin-bottom: 4px;
}

/* dialog section #controls button { padding: 0; background: none; ... } */
.a2ui-surface .a2ui-modal dialog section #controls button {
  padding: 0;
  background: none;
  width: 20px;
  height: 20px;
  cursor: pointer;
  border: none;
}

/* =========================================================================
 * Image (from Lit image.ts static styles)
 * ========================================================================= */

/* :host { display: block; flex: var(--weight); min-height: 0; overflow: auto; } */
.a2ui-surface .a2ui-image {
  display: block;
  flex: var(--weight);
  min-height: 0;
  overflow: auto;
}

/* img { display: block; width: 100%; height: 100%; object-fit: var(--object-fit, fill); } */
:where(.a2ui-surface .a2ui-image) img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: var(--object-fit, fill);
}

/* =========================================================================
 * Video (from Lit video.ts static styles)
 * ========================================================================= */

/* :host { display: block; flex: var(--weight); min-height: 0; overflow: auto; } */
.a2ui-surface .a2ui-video {
  display: block;
  flex: var(--weight);
  min-height: 0;
  overflow: auto;
}

/* video { display: block; width: 100%; } */
:where(.a2ui-surface .a2ui-video) video {
  display: block;
  width: 100%;
}

/* =========================================================================
 * AudioPlayer (from Lit audio.ts static styles)
 * ========================================================================= */

/* :host { display: block; flex: var(--weight); min-height: 0; overflow: auto; } */
.a2ui-surface .a2ui-audio {
  display: block;
  flex: var(--weight);
  min-height: 0;
  overflow: auto;
}

/* audio { display: block; width: 100%; } */
:where(.a2ui-surface .a2ui-audio) audio {
  display: block;
  width: 100%;
}

/* =========================================================================
 * MultipleChoice (from Lit multiple-choice.ts static styles)
 * ========================================================================= */

/* :host { display: block; flex: var(--weight); min-height: 0; overflow: auto; } */
.a2ui-surface .a2ui-multiplechoice {
  display: block;
  flex: var(--weight);
  min-height: 0;
  overflow: auto;
}

/* select { width: 100%; } */
:where(.a2ui-surface .a2ui-multiplechoice) select {
  width: 100%;
}

/* =========================================================================
 * Column (from Lit column.ts static styles)
 * ========================================================================= */

/* :host { display: flex; flex: var(--weight); } */
.a2ui-surface .a2ui-column {
  display: flex;
  flex: var(--weight);
}

/* section { display: flex; flex-direction: column; min-width: 100%; height: 100%; } */
.a2ui-surface .a2ui-column > section {
  display: flex;
  flex-direction: column;
  min-width: 100%;
  height: 100%;
}

/* :host([alignment="..."]) section { align-items: ...; } */
/* Use > section to only target Column's direct section, not nested sections (e.g., CheckBox's section) */
.a2ui-surface .a2ui-column[data-alignment="start"] > section { align-items: start; }
.a2ui-surface .a2ui-column[data-alignment="center"] > section { align-items: center; }
.a2ui-surface .a2ui-column[data-alignment="end"] > section { align-items: end; }
.a2ui-surface .a2ui-column[data-alignment="stretch"] > section { align-items: stretch; }

/* :host([distribution="..."]) section { justify-content: ...; } */
.a2ui-surface .a2ui-column[data-distribution="start"] > section { justify-content: start; }
.a2ui-surface .a2ui-column[data-distribution="center"] > section { justify-content: center; }
.a2ui-surface .a2ui-column[data-distribution="end"] > section { justify-content: end; }
.a2ui-surface .a2ui-column[data-distribution="spaceBetween"] > section { justify-content: space-between; }
.a2ui-surface .a2ui-column[data-distribution="spaceAround"] > section { justify-content: space-around; }
.a2ui-surface .a2ui-column[data-distribution="spaceEvenly"] > section { justify-content: space-evenly; }

/* =========================================================================
 * Row (from Lit row.ts static styles)
 * ========================================================================= */

/* :host { display: flex; flex: var(--weight); } */
.a2ui-surface .a2ui-row {
  display: flex;
  flex: var(--weight);
}

/* section { display: flex; flex-direction: row; width: 100%; min-height: 100%; } */
.a2ui-surface .a2ui-row > section {
  display: flex;
  flex-direction: row;
  width: 100%;
  min-height: 100%;
}

/* :host([alignment="..."]) section { align-items: ...; } */
/* Use > section to only target Row's direct section, not nested sections */
.a2ui-surface .a2ui-row[data-alignment="start"] > section { align-items: start; }
.a2ui-surface .a2ui-row[data-alignment="center"] > section { align-items: center; }
.a2ui-surface .a2ui-row[data-alignment="end"] > section { align-items: end; }
.a2ui-surface .a2ui-row[data-alignment="stretch"] > section { align-items: stretch; }

/* :host([distribution="..."]) section { justify-content: ...; } */
.a2ui-surface .a2ui-row[data-distribution="start"] > section { justify-content: start; }
.a2ui-surface .a2ui-row[data-distribution="center"] > section { justify-content: center; }
.a2ui-surface .a2ui-row[data-distribution="end"] > section { justify-content: end; }
.a2ui-surface .a2ui-row[data-distribution="spaceBetween"] > section { justify-content: space-between; }
.a2ui-surface .a2ui-row[data-distribution="spaceAround"] > section { justify-content: space-around; }
.a2ui-surface .a2ui-row[data-distribution="spaceEvenly"] > section { justify-content: space-evenly; }

/* =========================================================================
 * List (from Lit list.ts static styles)
 * ========================================================================= */

/* :host { display: block; flex: var(--weight); min-height: 0; overflow: auto; } */
.a2ui-surface .a2ui-list {
  display: block;
  flex: var(--weight);
  min-height: 0;
  overflow: auto;
}

/* :host([direction="vertical"]) section { display: grid; } */
.a2ui-surface .a2ui-list[data-direction="vertical"] > section {
  display: grid;
}

/* :host([direction="horizontal"]) section { display: flex; max-width: 100%; overflow-x: scroll; ... } */
.a2ui-surface .a2ui-list[data-direction="horizontal"] > section {
  display: flex;
  max-width: 100%;
  overflow-x: scroll;
  overflow-y: hidden;
  scrollbar-width: none;
}

/* :host([direction="horizontal"]) section > ::slotted(*) { flex: 1 0 fit-content; ... } */
.a2ui-surface .a2ui-list[data-direction="horizontal"] > section > * {
  flex: 1 0 fit-content;
  max-width: min(80%, 400px);
}

/* =========================================================================
 * DateTimeInput (from Lit datetime-input.ts static styles)
 * ========================================================================= */

/* :host { display: block; flex: var(--weight); min-height: 0; overflow: auto; } */
.a2ui-surface .a2ui-datetime-input {
  display: block;
  flex: var(--weight);
  min-height: 0;
  overflow: auto;
}

/* input { display: block; border-radius: 8px; padding: 8px; border: 1px solid #ccc; width: 100%; } */
/* Use :where() to match Lit's low specificity (0,0,0,1) so theme utility classes can override */
:where(.a2ui-surface .a2ui-datetime-input) input {
  display: block;
  border-radius: 8px;
  padding: 8px;
  border: 1px solid #ccc;
  width: 100%;
}

/* =========================================================================
 * Global box-sizing (matches Lit's * { box-sizing: border-box; } in components)
 * ========================================================================= */

.a2ui-surface *,
.a2ui-surface *::before,
.a2ui-surface *::after {
  box-sizing: border-box;
}
`;

/**
 * Injects A2UI structural styles into the document head.
 * Includes utility classes (layout-*, typography-*, color-*, etc.) and React-specific overrides.
 * Call this once at application startup.
 *
 * NOTE: CSS variables (--n-*, --p-*, etc.) must be defined by the host application on :root,
 * just like in the Lit renderer. This allows full customization of the color palette.
 *
 * @example
 * ```tsx
 * import { injectStyles } from '@a2ui/react/styles';
 *
 * // In your app entry point:
 * injectStyles();
 * ```
 */
export function injectStyles(): void {
  if (typeof document === 'undefined') {
    return; // SSR safety
  }

  const styleId = 'a2ui-structural-styles';

  // Avoid duplicate injection
  if (document.getElementById(styleId)) {
    return;
  }

  const styleElement = document.createElement('style');
  styleElement.id = styleId;
  // Include structural (utility classes) and component-specific styles
  // Note: CSS variables (palette) must be defined by the host application on :root,
  // just like in the Lit renderer. This allows full customization.
  styleElement.textContent = resetStyles + '\n' + structuralStyles + '\n' + componentSpecificStyles;
  document.head.appendChild(styleElement);
}

/**
 * Removes injected A2UI styles from the document.
 * Useful for cleanup in tests or when unmounting.
 */
export function removeStyles(): void {
  if (typeof document === 'undefined') {
    return;
  }

  const styleElement = document.getElementById('a2ui-structural-styles');
  if (styleElement) {
    styleElement.remove();
  }
}
