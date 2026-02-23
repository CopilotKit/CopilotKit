# CopilotKit ESLint Rules

## `copilotkit/require-cpk-prefix`

CopilotKit v2/react uses Tailwind v4's `prefix(cpk)` feature (configured in `src/styles/base.css`) to scope all generated CSS. This prevents CopilotKit's styles from colliding with the host application's own Tailwind classes.

The prefix means every Tailwind utility in component code must be written as `cpk:bg-white` instead of `bg-white`. If you forget the prefix, the class silently produces no CSS — there's no build error, no runtime error, just missing styles.

This ESLint rule catches that mistake inline in your editor.

### Prefix ordering (important!)

In Tailwind v4 with `prefix(cpk)`, the prefix **must come before all variants**:

```
cpk:dark:hover:bg-white   ✓  generates CSS
dark:hover:cpk:bg-white   ✗  generates NO CSS (silent failure)
```

This rule detects both problems:

1. **Missing prefix** — `bg-white` → `cpk:bg-white`
2. **Wrong prefix position** — `dark:cpk:bg-white` → `cpk:dark:bg-white`

### What it checks

- `className="..."` string literals
- ``className={`...`}`` template literals (including expressions inside `${}`)
- `cn(...)`, `twMerge(...)`, `cva(...)`, `clsx(...)` arguments
- Ternary and logical expressions inside className values

### Auto-fix

The rule is auto-fixable. Run `eslint --fix` or use your editor's quick-fix (`Cmd+.`) to insert or reposition the `cpk:` prefix automatically.

Variants are handled correctly — `dark:hover:bg-white` becomes `cpk:dark:hover:bg-white`.

### Examples

```tsx
// Bad — missing prefix (will warn)
<div className="flex items-center bg-white" />
<div className={cn("flex", isActive && "bg-blue-500")} />

// Bad — prefix in wrong position (will warn)
<div className="dark:cpk:bg-white hover:cpk:text-blue-500" />

// Good — no warning
<div className="cpk:flex cpk:items-center cpk:bg-white" />
<div className={cn("cpk:flex", isActive && "cpk:bg-blue-500")} />
<div className="cpk:dark:bg-white cpk:hover:text-blue-500" />
```
