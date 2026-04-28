# Showcase Integration Package — Styling Guide

When building demo pages for integration packages, follow these rules to avoid common pitfalls.

## Tailwind v4 Purging

**Tailwind v4 aggressively purges CSS classes it can't statically analyze.** If your component renders Tailwind classes dynamically (e.g., from state, props, or conditional logic), those classes will be missing from the CSS bundle.

### Do: Use inline styles for dynamic components

```tsx
// GOOD — inline styles always work
<div style={{ padding: "32px", borderRadius: "16px", border: "1px solid #e5e5e0" }}>
```

### Don't: Use Tailwind classes on dynamically rendered content

```tsx
// BAD — Tailwind may purge these classes
<div className="p-8 rounded-2xl border border-gray-200">
```

### When it's safe to use Tailwind

Tailwind classes work fine on:

- Static JSX in your component (not inside maps, conditionals, or dynamic renders)
- The CopilotKit wrapper divs you write yourself
- Next.js page-level layout elements

Tailwind classes are UNSAFE on:

- Content rendered by `useRenderTool`, `useHumanInTheLoop`, `useFrontendTool` handlers
- Components rendered inside CopilotKit's chat message area
- Any JSX returned from a callback or dynamic render function

## CopilotKit Component Overrides

CopilotKit v2 components use `cpk:` prefixed Tailwind classes internally. To override them:

### Do: Use a separate CSS file

```css
/* copilotkit-overrides.css — import in layout.tsx AFTER globals.css */

.copilotKitInput {
  border-radius: 0.75rem;
  border: 1px solid var(--copilot-kit-separator-color) !important;
}

.copilotKitChat {
  background-color: #fff !important;
}
```

```tsx
// layout.tsx
import "./globals.css";
import "./copilotkit-overrides.css"; // AFTER globals
```

### Don't: Put overrides in globals.css

Tailwind v4 processes `globals.css` and purges anything it doesn't recognize as a utility class. CopilotKit class selectors (`.copilotKitChat`, `.copilotKitInput`) will be stripped.

## Chat Layout — The Wrapper Pattern

To get proper spacing around the CopilotChat component, wrap it like the Dojo does:

```tsx
// GOOD — matches Dojo spacing
<div className="flex justify-center items-center h-screen w-full">
  <div className="h-full w-full md:w-4/5 md:h-4/5 rounded-lg">
    <CopilotChat className="h-full rounded-2xl max-w-6xl mx-auto" />
  </div>
</div>
```

The `md:w-4/5` gives 80% width on desktop, creating natural side margins. Don't try to add margins via CSS overrides on CopilotKit's internal classes — use the wrapper div.

## Theme

All integration packages should use the light theme to match the showcase shell:

```css
:root {
  --copilot-kit-background-color: #fafaf9;
  --copilot-kit-primary-color: #0d6e3f;
  --copilot-kit-response-button-background-color: #f5f5f3;
  --copilot-kit-response-button-color: #1a1a18;
}

html,
body {
  background: #fafaf9;
  color: #1a1a18;
}
```

## Images

Don't reference local image files from agent-generated content. The agent may generate `image_name` values that don't exist on disk. Always add an `onError` fallback:

```tsx
{
  imageUrl && !imageError && (
    <img src={imageUrl} onError={() => setImageError(true)} alt="..." />
  );
}
```

## SVG Icons

Don't use SVG icons with `fill="currentColor"` inside CopilotKit chat messages. The `currentColor` inheritance is unpredictable in the chat context. Use emoji instead:

```tsx
// GOOD
<span style={{ fontSize: "48px" }}>☀️</span>

// BAD — renders as giant black shapes
<svg fill="currentColor" className="w-14 h-14 text-yellow-200">...</svg>
```

## Testing Locally

Always build and test the Docker image locally before pushing:

```bash
cd /proj/cpk/CopilotKit
docker build -f showcase/integrations/<slug>/Dockerfile -t <slug>-local showcase/integrations/<slug>/
docker run -d --name <slug>-local -p 4444:10000 -e PORT=10000 <slug>-local

# Verify CSS overrides survived the build
curl -sf http://localhost:4444/_next/static/css/*.css | grep "copilotKitChat"

# Verify inline styles are in rendered HTML
curl -sf http://localhost:4444/demos/<demo> | grep "padding: 32px"

# Clean up
docker rm -f <slug>-local
```
