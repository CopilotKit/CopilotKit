# A2UI React Renderer — Style Architecture

The React renderer uses Light DOM (regular HTML elements), unlike the Lit
renderer which uses Shadow DOM with built-in style encapsulation. This means
all CSS lives in the global document scope and must be carefully organized to
avoid conflicts with host-app stylesheets.

All styles are injected into a single `<style id="a2ui-structural-styles">`
element in the document head via `injectStyles()`.

## Style Layers (lowest → highest priority)

### 1. Browser Default Reset (`reset.ts`)

```css
@layer a2ui-reset {
  :where(.a2ui-surface) :where(*) { all: revert; }
}
```

**Purpose:** Restores browser-default styles (heading margins, list styles,
form appearance, etc.) inside `.a2ui-surface`. Without this, host-app CSS
resets like Tailwind preflight strip defaults that the renderer expects.

**Why it works:** CSS `@layer` styles have the lowest author-level priority.
Every other A2UI style is unlayered and automatically overrides the reset.
The `:where()` wrapper also zeroes specificity for extra safety.

**Why it's needed:** The Lit renderer doesn't need this because Shadow DOM
isolates its elements from external stylesheets. The React renderer uses
Light DOM, so host-app resets leak in.

### 2. Structural / Utility Classes (`structuralStyles`)

```
Imported from: @a2ui/lit/0.8 → Styles.structuralStyles
Transform:     :host { ... }  →  .a2ui-surface { ... }
```

Utility classes shared between all renderers, generated from `web_core`:

| Prefix          | Source file       | Examples                          |
|-----------------|-------------------|-----------------------------------|
| `layout-*`      | `styles/layout.ts`    | `layout-p-2`, `layout-m-0`, `layout-w-100` |
| `typography-*`  | `styles/type.ts`      | `typography-f-sf`, `typography-sz-tl`       |
| `color-*`       | `styles/colors.ts`    | `color-c-n100`, `color-bgc-p30`            |
| `border-*`      | `styles/border.ts`    | `border-br-12`, `border-bw-1`              |
| `behavior-*`    | `styles/behavior.ts`  | `behavior-ho-70`                           |
| `opacity-*`     | `styles/opacity.ts`   | `opacity-50`                               |

**Specificity:** Single class selector — `(0,1,0)`.

These classes are applied to HTML elements via the theme's class maps
(e.g. `{ 'layout-p-2': true, 'color-bgc-p30': true }`), which components
convert to `className` strings using `classMapToString()`.

### 3. Component-Specific Styles (`componentSpecificStyles`)

Hand-written CSS that replicates each Lit component's `static styles`.
Covers host-level layout (`display`, `flex`) and element-level defaults.

**Two specificity tiers:**

- **Host styles** — `.a2ui-surface .a2ui-{component}` — specificity `(0,2,0)`
  ```css
  .a2ui-surface .a2ui-card { display: block; flex: var(--weight); }
  ```

- **Element styles** — `:where(.a2ui-surface .a2ui-{component}) element` — specificity `(0,0,1)`
  ```css
  :where(.a2ui-surface .a2ui-image) img { display: block; width: 100%; }
  ```

  `:where()` zeroes the wrapper specificity so that theme utility classes
  (specificity `(0,1,0)`) can override element defaults.

### 4. Theme Class Maps (`theme.components.*`)

Applied per-component as CSS class names. The theme object provides
`Record<string, boolean>` maps that reference utility classes from layer 2.

```typescript
// From the theme object
Button: { 'color-bgc-p30': true, 'color-c-n100': true, ... }
```

Components merge these with `classMapToString()` and apply as `className`:
```tsx
<button className={classMapToString(theme.components.Button)}>
```

**Specificity:** Same as utility classes — `(0,1,0)`.

### 5. Theme Element Styles (`theme.elements.*`)

Applied to raw HTML elements rendered inside components (e.g. `<h1>`,
`<input>`, `<button>` inside Text, TextField, Button). Same mechanism
as component class maps.

### 6. Theme Additional Styles (`theme.additionalStyles.*`)

Applied as **inline styles** via React's `style` prop. Used for CSS custom
properties and direct property overrides.

```typescript
// Theme definition
additionalStyles: {
  Button: { '--n-35': 'var(--n-100)' },
  Card: { padding: '32px' },
}

// Component application
<button style={stylesToObject(theme.additionalStyles?.Button)}>
```

**Specificity:** Inline styles — `(1,0,0)`. Always wins over class-based styles.

### 7. Inline Layout Styles

Components set `--weight` and other layout vars as inline styles based on
component properties:

```tsx
<div className="a2ui-card" style={{ '--weight': node.weight }}>
```

**Specificity:** `(1,0,0)` — same as additionalStyles.

## CSS Variable Dependencies

The renderer expects color palette variables to be defined by the host
application on `:root` or a parent element. These are consumed by the
utility classes:

```css
/* Neutral */     --n-0 through --n-100, --nv-0 through --nv-100
/* Primary */     --p-0 through --p-100
/* Secondary */   --s-0 through --s-100
/* Tertiary */    --t-0 through --t-100
/* Error */       --e-0 through --e-100
```

In the Lit renderer, `@copilotkit/a2ui-renderer` bundles these internally.
For the React renderer, the host app must provide them (e.g. via
`a2ui-palette.css`).

## Override Priority Summary

```
  Highest ──┐
             │  Inline styles (additionalStyles, --weight)     (1,0,0)
             │  Theme utility classes / element classes         (0,1,0)
             │  Component host styles (.a2ui-surface .a2ui-*)  (0,2,0)
             │  Component element styles (:where(...) elem)    (0,0,1)
             │  Structural utility classes                     (0,1,0)
             │  Browser default reset (@layer a2ui-reset)      layered
  Lowest  ───┘
```

Note: Component host styles have higher specificity `(0,2,0)` than utility
classes `(0,1,0)`, but they only set structural properties (`display`,
`flex`, `overflow`) that theme utilities don't typically target — so there
is no conflict in practice.

## File Overview

| File        | Purpose                                              |
|-------------|------------------------------------------------------|
| `reset.ts`  | `all: revert` in `@layer` — restores browser defaults |
| `index.ts`  | Structural utilities, component CSS, injection logic |
