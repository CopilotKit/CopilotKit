# CopilotKit Documentation

This is the CopilotKit documentation site, built with Next.js and [Fumadocs](https://fumadocs.vercel.app).

## Getting Started

Run the development server:

```bash
pnpm dev
```

Open http://localhost:3000 with your browser to see the result.

Build for production:

```bash
pnpm build
```

## Architecture

### Integration Management

The documentation supports multiple framework integrations (LangGraph, CrewAI, etc.). To maintain consistency and avoid duplication, we use a **single source of truth** approach:

#### 1. Integration Order & Metadata

All integration ordering and metadata is defined in **`lib/integrations.ts`**:

```typescript
// Define order here - this is the canonical order
export const INTEGRATION_ORDER = [
  'adk',
  'a2a',
  'microsoft-agent-framework',
  // ... etc
] as const;

// Define metadata (labels, hrefs)
export const INTEGRATION_METADATA = {
  'adk': { label: 'ADK', href: '/adk' },
  // ... etc
};
```

This single file controls:
- Sidebar integration list
- Integration dropdown selector  
- Integration button grid on landing pages
- All integration UI components

**To reorder integrations:** Update `INTEGRATION_ORDER` in `lib/integrations.ts` and `content/docs/integrations/meta.json` to match.

#### 2. Feature Availability (Auto-Generated)

Which integrations appear on feature pages (e.g., `/shared-state`, `/generative-ui`) is **automatically detected** from the file system.

**The script:** `scripts/generate-integration-features.mjs`
- Scans `content/docs/integrations/` for feature directories/files
- Generates `lib/integration-features.ts` with type-safe mappings
- Runs automatically before every build and dev server start

**Features detected:**
- `shared-state/` (directory)
- `generative-ui/` (directory)
- `frontend-actions.mdx` (file)
- `human-in-the-loop.mdx` (file)
- `agentic-chat-ui.mdx` (file)
- `custom-look-and-feel/` (directory)

**To add a feature to an integration:**

Just create the directory or file - no code changes needed!

```bash
# Example: Add shared-state support to agno
mkdir content/docs/integrations/agno/shared-state

# Next build will automatically include agno in the shared-state picker
pnpm dev  # Auto-generates the feature map
```

**To manually regenerate:**

```bash
pnpm generate
```

#### 3. Content Structure

Integration docs live in `content/docs/integrations/{integration-id}/`:

```
content/docs/integrations/
├── adk/
│   ├── index.mdx               # Landing page
│   ├── shared-state/           # Feature directory
│   ├── generative-ui/          # Feature directory
│   └── frontend-actions.mdx    # Feature file
├── langgraph/
│   ├── index.mdx
│   └── ...
└── meta.json                    # Controls sidebar order
```

The `meta.json` `pages` array should match `INTEGRATION_ORDER` from `lib/integrations.ts`.

#### 4. UI Components

All components consume the centralized data:

- **`components/ui/sidebar/integration-link.tsx`** - Sidebar links
- **`components/ui/integrations-sidebar/integration-selector.tsx`** - Dropdown selector
- **`components/react/integration-link-button/integration-button-group.tsx`** - Button grid
- **`components/react/integrations.tsx`** - Dynamic integration grids with feature filtering

These components import from `lib/integrations.ts` and `lib/integration-features.ts` - **never hardcode integration lists!**

## Adding a New Integration

1. **Create content directory:**
   ```bash
   mkdir content/docs/integrations/my-framework
   ```

2. **Add to `lib/integrations.ts`:**
   ```typescript
   export const INTEGRATION_ORDER = [
     'adk',
     'my-framework',  // Add in desired order
     // ...
   ];
   
   export const INTEGRATION_METADATA = {
     // ...
     'my-framework': { 
       label: 'My Framework', 
       href: '/my-framework' 
     },
   };
   ```

3. **Add to `content/docs/integrations/meta.json`:**
   ```json
   {
     "pages": [
       "adk",
       "my-framework",
       ...
     ]
   }
   ```

4. **Create the icon:**
   - Add SVG to `components/ui/icons/my-framework.tsx`
   - Import and register in all UI components that use icons

5. **Add feature pages as needed:**
   ```bash
   mkdir content/docs/integrations/my-framework/shared-state
   # Auto-detected on next build!
   ```

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Fumadocs](https://fumadocs.vercel.app)
- [MDX](https://mdxjs.com/)
