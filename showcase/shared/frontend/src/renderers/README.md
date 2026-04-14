# Renderer Adapter System

5 GenUI rendering strategies for the Sales Dashboard, switchable via a pill toggle.

## Adding a 6th Renderer

1. Create `src/renderers/<name>/index.tsx` — export a dashboard component
2. Create `src/renderers/<name>/README.md` — explain the approach
3. Add the mode to `RenderMode` union in `types.ts`
4. Add an entry to `RENDER_STRATEGIES` array in `types.ts`
5. Export from `src/renderers/index.ts`
6. Export from `src/index.ts`
7. Add tests in `__tests__/<name>.test.tsx`
8. Update consumer pages' mode switch to render the new component

## Architecture

```
User clicks pill → useRenderMode() updates state + localStorage
                 → useAgentContext forwards render_mode to agent
                 → Backend middleware reads render_mode from context
                 → Adjusts agent output format per mode
                 → Frontend renderer component interprets the output
```

## Strategies

| Mode        | Agent Output                      | Frontend Rendering                 |
| ----------- | --------------------------------- | ---------------------------------- |
| tool-based  | Text + tool calls                 | useComponent hooks                 |
| a2ui        | Text + A2UI operations            | createCatalog renders              |
| hashbrown   | Structured JSON (response_format) | useJsonParser + kit.render         |
| json-render | JSONL patches in text (deferred)  | Renderer + createMixedStreamParser |
| open-genui  | HTML/JS/CSS                       | Sandboxed iframe                   |
