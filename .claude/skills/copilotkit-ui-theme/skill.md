---
name: copilotkit-ui-theme
description: Apply the CopilotKit / CopilotCloud visual design system to any web UI. Use when building demos, showcases, internal tools, presentations, or any frontend that should look like an official CopilotKit product. Covers colors, typography, spacing, component patterns, and background effects.
---

# CopilotKit UI Theme — Complete Design System Reference

This skill contains everything you need to make a web UI look like an official CopilotKit product. Apply these values exactly — do not approximate or improvise colors, fonts, or spacing.

## Reference Implementation

A fully working example lives at `showcase/shell-dojolike/` in the CopilotKit repo. When in doubt, read that code — it implements every pattern described here. The canonical source of truth for the design system is the AG-UI dojo at `/Users/ataibarkai/LocalGit/ag-ui/apps/dojo/`, specifically:
- `src/app/globals.css` — all color tokens
- `src/styles/typography.css` — all type classes
- `src/components/layout/viewer-layout.tsx` — background blur circles
- `src/components/sidebar/sidebar.tsx` — sidebar layout patterns
- `src/components/demo-list/demo-list.tsx` — list item patterns

---

## 1. Color Palette (CopilotCloud Design System)

### Surface Colors
| Token | Value | Usage |
|-------|-------|-------|
| `surface-main` | `#dedee9` | Page background — the cool lavender-gray that defines the CopilotKit look |
| `surface-container` | `#ffffff` | Cards, popover backgrounds |
| `surface-containerHovered` | `#fafcfa` | Hover state for interactive containers |
| `surface-background` | `#dbdbe5` | Secondary backgrounds |

### Translucent Surface Layers (Critical Pattern)
These translucent whites over the lavender background create the "glass" effect:
| Token | Value | Usage |
|-------|-------|-------|
| `white/50` | `rgba(255, 255, 255, 0.5)` | Sidebar background, cards |
| `white/70` | `rgba(255, 255, 255, 0.7)` | Selected list items |
| `white/65` | `rgba(255, 255, 255, 0.65)` | Unselected tag badges |
| `white/50` | `rgba(255, 255, 255, 0.5)` | Hovered list items |

### Border Colors
| Token | Value | Usage |
|-------|-------|-------|
| `border-default` | `#ffffff` | Sidebar and card borders (yes, white borders — this is intentional and critical) |
| `border-container` | `#dbdbe5` | Dividers, dropdown borders, section separators |

### Text Colors
| Token | Value | Usage |
|-------|-------|-------|
| `text-primary` | `#010507` | Main text, headings, demo names |
| `text-secondary` | `#57575b` | Section labels ("INTEGRATIONS", "VIEW", "DEMOS") |
| `text-disabled` | `#838389` | Descriptions, muted text, line numbers |
| `text-invert` | `#ffffff` | Text on dark backgrounds (selected tags) |

### Grey Scale
```
grey-0:    #ffffff
grey-25:   #fafcfa
grey-100:  #f7f7f9
grey-200:  #f0f0f4    (dropdown hover)
grey-300:  #e9e9ef
grey-400:  #e2e2ea
grey-500:  #dbdbe5    (= border-container)
grey-600:  #afafb7
grey-700:  #838389    (= text-disabled)
grey-800:  #575758
grey-900:  #2b2b2b
grey-1000: #010507    (= text-primary)
```

### Accent Colors (for decorative blur circles)
```
orange-400/20:  rgba(255, 172, 77, 0.2)
yellow-400/30:  rgba(255, 243, 136, 0.3)
grey-wash:      #C9C9DA
off-white-wash: #F3F3FC
```

---

## 2. Typography

### Font Families
```css
/* Body text — MUST use this, not system fonts */
font-family: "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif;

/* Code and monospace details */
font-family: "Spline Sans Mono", ui-monospace, SFMono-Regular, monospace;
```

**Loading fonts**: Add to your HTML `<head>`:
```html
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=Spline+Sans+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
```

In Next.js, add the `<link>` tag in `layout.tsx` inside a `<head>` element. Do NOT use `@import url()` in CSS — Tailwind v4 will reject it.

### Type Scale (exact values from CopilotCloud typography system)

#### Headings (Plus Jakarta Sans)
| Class | Size | Line-height | Weight |
|-------|------|-------------|--------|
| H1 | 56px | 64px | 600 (SemiBold) or 500 (Medium) |
| H2 | 40px | 46px | 600 or 500 |
| H3 | 32px | 36px | 600 or 500 |
| H4 | 24px | 28px | 600 or 500 |
| H5 | 20px | 24px | 600 or 500 |
| H6 | 18px | 20px | 600 or 500 |

#### Paragraphs (Plus Jakarta Sans)
| Class | Size | Line-height | Weight |
|-------|------|-------------|--------|
| Large | 16px | 24px | 400–700 |
| Medium | 14px | 22px | 400–600 |
| Small | 12px | 16px | 400–600 |

#### Details / Monospace (Spline Sans Mono)
| Class | Size | Line-height | Weight |
|-------|------|-------------|--------|
| Medium | 14px | 14px | 500 |
| Small | 12px | 12px | 500 |
| ExtraSmall | 10px | 10px | 500 |

### Common UI Element Typography
These are the exact specs used in the dojo sidebar — use these for any similar layout:

| Element | Font size | Weight | Line-height | Extra |
|---------|-----------|--------|-------------|-------|
| App title | 18px | 300 (light) | 20px | — |
| Section label (INTEGRATIONS, VIEW) | 10px | 400 | — | uppercase, color: text-secondary |
| Integration name in picker | 14px | 500 | 22px | pb: 2px |
| Dropdown menu items | 16px | 400 | — | height: 48px |
| View tab labels | 14px | 500 | — | height: 32px |
| List item name | 14px | 500 | 1.25 (leading-tight) | — |
| List item description | 12px | 400 | 1.625 (leading-relaxed) | color: text-disabled, line-clamp: 2 |
| Tag/badge text | 12px | 400 | 1.4 | — |
| Code file tabs | 13px | 500/400 | — | Spline Sans Mono |
| Code content | 13px | 400 | 1.5 | Spline Sans Mono |

---

## 3. Spacing System

Based on a 4px grid:
```
spacing-1:  4px      spacing-7:  28px     spacing-13: 52px
spacing-2:  8px      spacing-8:  32px     spacing-14: 56px
spacing-3:  12px     spacing-9:  36px     spacing-15: 60px
spacing-4:  16px     spacing-10: 40px     spacing-16: 64px
spacing-5:  20px     spacing-11: 44px     spacing-17: 68px
spacing-6:  24px     spacing-12: 48px     spacing-18: 72px
```

### Common Spacing Patterns
- **Page padding**: 8px (the gap between viewport edges and content cards)
- **Gap between sidebar and content**: 8px
- **Sidebar internal padding**: 16px (`p-4`)
- **Section margin-bottom**: 16px
- **Section title margin-bottom**: 8px
- **List container padding**: 8px horizontal
- **List item padding**: 8px vertical, 12px horizontal (`py-2 px-3`)
- **List item internal gap**: 2px (`gap-0.5`)
- **List items vertical spacing**: 4px (`space-y-1`)
- **Tag gap**: 4px, margin-top: 2px
- **Tag padding**: 2px vertical, 6px horizontal (`py-0.5 px-1.5`)

---

## 4. Border Radius

```
xs:  4px     (list items, dropdowns — "rounded-sm")
sm:  8px     (sidebar, content cards, tabs — "rounded-lg")  
md:  12px
lg:  16px
xl:  24px
2xl: 48px
3xl: 200px
full: 9999px (tags/badges — "rounded-full")
```

---

## 5. Shadows / Elevation

```css
elevation-sm: 0px 1px 3px 0px rgba(1, 5, 7, 0.08);
elevation-md: 0px 6px 6px -2px rgba(1, 5, 7, 0.08);    /* dropdowns */
elevation-lg: 0px 16px 24px -8px rgba(1, 5, 7, 0.12);
elevation-xl: 0px 24px 32px -12px rgba(1, 5, 7, 0.16);
```

---

## 6. Background Blur Circles (Signature CopilotKit Effect)

The page background is NOT just a flat `#dedee9`. Behind the content, there are 6 large, heavily-blurred colored ellipses that create subtle warmth and depth. These are positioned absolutely relative to the page viewport.

**You MUST include these.** They are what makes a CopilotKit UI feel alive rather than flat.

```jsx
{/* Background blur circles — CopilotCloud Figma specs */}
<div style={{ position: "absolute", width: 446, height: 446, left: 1040, top: 11,
  borderRadius: "50%", background: "rgba(255, 172, 77, 0.2)", filter: "blur(103px)", zIndex: 0 }} />
<div style={{ position: "absolute", width: 609, height: 609, left: 1339, top: 625,
  borderRadius: "50%", background: "#C9C9DA", filter: "blur(103px)", zIndex: 0 }} />
<div style={{ position: "absolute", width: 609, height: 609, left: 670, top: -365,
  borderRadius: "50%", background: "#C9C9DA", filter: "blur(103px)", zIndex: 0 }} />
<div style={{ position: "absolute", width: 609, height: 609, left: 508, top: 702,
  borderRadius: "50%", background: "#F3F3FC", filter: "blur(103px)", zIndex: 0 }} />
<div style={{ position: "absolute", width: 446, height: 446, left: 128, top: 331,
  borderRadius: "50%", background: "rgba(255, 243, 136, 0.3)", filter: "blur(103px)", zIndex: 0 }} />
<div style={{ position: "absolute", width: 446, height: 446, left: -205, top: 803,
  borderRadius: "50%", background: "rgba(255, 172, 77, 0.2)", filter: "blur(103px)", zIndex: 0 }} />
```

The containing element must have `position: relative` and `overflow: hidden`. All content cards must have `zIndex: 1` to sit above the circles.

---

## 7. Component Patterns

### Glass Sidebar / Card
```css
background: rgba(255, 255, 255, 0.5);
border: 2px solid #ffffff;
border-radius: 8px;
```
This creates the frosted-glass look. The white border is what separates it from the blur circles behind it.

### Section Title with Extending Line
A label on the left, followed by a 1px line that extends to fill the remaining width:
```jsx
<div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 4px", marginBottom: 8 }}>
    <span style={{ fontSize: 10, fontWeight: 400, textTransform: "uppercase",
        letterSpacing: "0.05em", color: "#57575b", whiteSpace: "nowrap" }}>
        {title}
    </span>
    <div style={{ flex: 1, height: 1, background: "#dbdbe5" }} />
</div>
```

### List Item (Demo, Nav, etc.)
```css
/* Default state */
padding: 8px 12px;
border-radius: 4px;
background: transparent;

/* Hover */
background: rgba(255, 255, 255, 0.5);

/* Selected */
background: rgba(255, 255, 255, 0.7);
```

### Tag / Badge
```css
/* Unselected */
font-size: 12px;
padding: 2px 6px;
border-radius: 9999px;
background: rgba(255, 255, 255, 0.65);
color: #010507;

/* Selected (inside a selected list item) */
background: #010507;
color: #ffffff;
```

### Dropdown / Popover
```css
background: #ffffff;
border: 1px solid #dbdbe5;
border-radius: 4px;
box-shadow: 0px 6px 6px -2px rgba(1, 5, 7, 0.08);
```

### View Toggle Tabs
Inline buttons, the active one gets a white background:
```css
/* Each tab */
flex: 1;
height: 32px;
font-size: 14px;
font-weight: 500;
border: none;
border-radius: 8px;
cursor: pointer;

/* Active */
background: #ffffff;

/* Inactive */
background: transparent;
```

---

## 8. CSS Setup (Tailwind v4 / Next.js)

### globals.css
```css
@import "tailwindcss";

:root {
    --surface-main: #dedee9;
    --surface-container: #ffffff;
    --border-default: #ffffff;
    --border-container: #dbdbe5;
    --text-primary: #010507;
    --text-secondary: #57575b;
    --text-disabled: #838389;
    --text-invert: #ffffff;
}

* { box-sizing: border-box; }

body {
    margin: 0;
    background: var(--surface-main);
    color: var(--text-primary);
    font-family: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
}
```

If you need syntax highlighting, also add:
```css
@import "highlight.js/styles/github.css";
```

### postcss.config.mjs
```js
const config = { plugins: { "@tailwindcss/postcss": {} } };
export default config;
```

---

## 9. Quick Checklist

When reviewing your implementation, verify ALL of these:

- [ ] Background is `#dedee9` (lavender-gray), NOT white, NOT warm gray
- [ ] 6 blur circles are present behind content
- [ ] Sidebar/cards use `rgba(255,255,255,0.5)` NOT solid white
- [ ] Borders are `2px solid #ffffff` (white), NOT gray
- [ ] Font is Plus Jakarta Sans (loaded via Google Fonts `<link>` in `<head>`)
- [ ] Title is weight 300 (light), NOT bold
- [ ] Section labels are 10px uppercase with extending line
- [ ] List items hover to `white/50`, selected is `white/70`
- [ ] Tags are `white/65` by default, `black bg + white text` when selected
- [ ] All content has `zIndex: 1` to sit above blur circles
- [ ] Code uses Spline Sans Mono
- [ ] Spacing follows 4px grid (8px page padding, 16px sidebar padding, etc.)
- [ ] Rounded corners: 4px for items, 8px for cards/sidebar, 9999px for tags
- [ ] No purple accent bar (that was an earlier wrong direction)
- [ ] Shadow on dropdowns: `0px 6px 6px -2px rgba(1, 5, 7, 0.08)`

---

## 10. Anti-Patterns (Do NOT Do These)

- Do NOT use a warm gray or off-white background. The CopilotKit background is specifically a cool lavender-gray (`#dedee9`).
- Do NOT use solid white for sidebar/card backgrounds. Use translucent `rgba(255,255,255,0.5)`.
- Do NOT use gray borders on the sidebar. The border is WHITE (`#ffffff`), creating a frost-glass edge effect.
- Do NOT use system fonts or forget to load Plus Jakarta Sans. The font is critical to the CopilotKit look.
- Do NOT use bold (700) for the app title. It's light (300).
- Do NOT use filled/colored buttons for view toggles. Active = white bg, inactive = transparent.
- Do NOT skip the blur circles. Without them, the UI looks flat and generic.
- Do NOT use `@import url()` for Google Fonts in CSS with Tailwind v4 — it will cause a parse error. Use a `<link>` tag instead.
