# CopilotKit + A2A Migration Notes

This document captures the dependency and import migration from legacy
`@copilotkitnext/*` packages to the current `@copilotkit/*` stack.

## Dependency updates

- `@copilotkitnext/core` -> removed
- `@copilotkitnext/react` -> removed
- `@copilotkitnext/runtime` -> removed
- `@copilotkitnext/shared` -> removed
- `@copilotkitnext/web-inspector` -> removed
- `@copilotkit/react-core` -> `^1.54.1`
- `@copilotkit/react-ui` -> `^1.54.1`
- `@copilotkit/runtime` -> `^1.54.1`
- `@copilotkit/a2ui-renderer` -> `^1.54.1`
- `@a2a-js/sdk` -> `^0.3.13` (from `^0.2.5`)
- `next` -> `16.2.2`
- `react` / `react-dom` -> `19.2.4`

Also removed legacy install workaround:

- deleted `.npmrc` (`legacy-peer-deps=true`)

## Import migration

- Frontend provider/chat moved to:
  - `@copilotkit/react-core/v2`
- Runtime endpoint moved to:
  - `@copilotkit/runtime/v2`

Files updated:

- `src/app/components/A2UIPage.tsx`
- `src/app/page.tsx`
- `src/app/api/copilotkit-a2ui/[[...slug]]/route.ts`

## A2A SDK compatibility notes

`@a2a-js/sdk` 0.3.x introduces protocol-related breaking changes across 0.3.0,
0.3.3, and 0.3.8. To reduce rollout risk:

- prefer `A2A_AGENT_CARD_URL` for explicit card URL configuration
- keep `A2A_AGENT_URL` as fallback for existing deployments
- default remains `http://localhost:10002`

Current route now uses:

- `A2A_AGENT_CARD_URL` -> first choice
- `A2A_AGENT_URL` -> fallback

## Verification checklist

Run these commands from this directory:

```bash
npm install
npx eslint "src/app/components/A2UIPage.tsx" "src/app/page.tsx" "src/app/api/copilotkit-a2ui/[[...slug]]/route.ts"
npm run dev
```

Expected:

- install succeeds without requiring `legacy-peer-deps`
- migrated source files lint clean
- app starts and A2UI flow can be tested via `/api/copilotkit-a2ui`

Note:

- `npm run build` may still fail on unrelated `specification/*` TypeScript
  dependencies (pre-existing in this showcase), not on migrated app sources.
