# Preview envs

One-shot scripts for spinning up local previews of showcase apps.

## `shell-docs.sh`

Boots `showcase/shell-docs` (the docs site) on **http://localhost:3003**.

```bash
./.claude/preview/shell-docs.sh
```

What it does (idempotent):

1. Installs `@copilotkit/showcase-scripts` workspace deps via `pnpm` — needed by the predev generators. Skipped if `showcase/scripts/node_modules` already exists.
2. Installs `showcase/shell-docs` deps via `npm` — shell-docs is npm-managed (its own `package-lock.json`) and is explicitly excluded from the pnpm workspace. Skipped if `showcase/shell-docs/node_modules` already exists.
3. Runs the three predev generators (`generate-registry`, `bundle-demo-content`, `generate-search-index`) that produce the gitignored JSON under `showcase/shell-docs/src/data/`.
4. Boots `next dev` in the foreground. Ctrl-C kills it cleanly.

### Env overrides

| Var                     | Default                  |
| ----------------------- | ------------------------ |
| `PORT`                  | `3003`                   |
| `NEXT_PUBLIC_BASE_URL`  | `http://localhost:$PORT` |
| `NEXT_PUBLIC_SHELL_URL` | `http://localhost:3000`  |

### Known caveats

- The root `prepare` script runs `lefthook install`, which can fail inside a worktree because `core.hooksPath` is set on the main checkout. The script tolerates this — workspace deps land regardless.
- Next 16 warns about multiple lockfiles (worktree + main checkout). Cosmetic, not a blocker.
- Next 16 deprecates the `middleware.ts` file convention in favor of `proxy.ts`. The existing `src/middleware.ts` still works; rename when you're ready.
