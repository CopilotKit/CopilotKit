# ESLint + Prettier → oxlint + oxfmt Migration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace ESLint and Prettier with oxlint and oxfmt for faster linting and formatting across the entire
monorepo.

**Architecture:** Single root-level `.oxlintrc.json` and `.oxfmtrc.json` replace all per-project ESLint configs and
scattered Prettier configs. The custom `require-cpk-prefix` rule is preserved as an oxlint JS plugin. All package.json
scripts, CI workflows, and git hooks are updated to use the new tools.

**Tech Stack:** oxlint (linting), oxfmt (formatting), pnpm, Nx

---

### Task 1: Install oxlint + oxfmt and remove ESLint + Prettier dependencies

**Files:**

- Modify: `package.json` (root)

**Step 1: Add oxlint and oxfmt as root devDependencies**

```bash
pnpm add -D oxlint oxfmt -w
```

**Step 2: Remove ESLint and Prettier root devDependencies**

```bash
pnpm remove eslint prettier prettier-plugin-tailwindcss eslint-config-custom -w
```

**Step 3: Remove ESLint devDependencies from v2/eslint-config**

```bash
pnpm remove @eslint/js eslint eslint-config-prettier eslint-plugin-only-warn eslint-plugin-react eslint-plugin-react-hooks eslint-plugin-turbo globals typescript-eslint @next/eslint-plugin-next --filter @copilotkitnext/eslint-config
```

**Step 4: Remove ESLint devDependencies from v1/eslint-config-custom**

```bash
pnpm remove eslint-config-next eslint-config-prettier eslint-plugin-react eslint-config-turbo --filter eslint-config-custom
```

**Step 5: Remove any ESLint dependencies from example packages that have them**

Check and remove eslint-related deps from:

- `examples/v1/research-canvas/package.json`
- `examples/v2/react/demo/package.json`
- `examples/v2/interrupts-langgraph/apps/web/package.json`
- Any other example with eslint in devDependencies

**Step 6: Verify install**

```bash
pnpm install --frozen-lockfile || pnpm install
npx oxlint --version
npx oxfmt --version
```

Expected: Both print version numbers.

**Step 7: Commit**

```
chore: add oxlint + oxfmt, remove eslint + prettier deps
```

---

### Task 2: Generate oxfmt config via migration and create oxlint config

**Files:**

- Create: `.oxfmtrc.json` (root)
- Create: `.oxlintrc.json` (root)
- Create: `packages/v2/react/eslint-rules/copilotkit-plugin.mjs` (oxlint JS plugin wrapper)

**Step 1: Run oxfmt's prettier migration**

```bash
npx oxfmt --migrate=prettier
```

This generates `.oxfmtrc.json` from the existing prettier config. Review and adjust the output. The target config should
look like:

```json
{
  "printWidth": 120,
  "proseWrap": "always"
}
```

If `--migrate=prettier` doesn't pick up the right config (there are multiple `.prettierrc` files in subdirs, not at
root), create it manually with the V2 settings above.

**Step 2: Create root `.oxlintrc.json`**

```json
{
  "$schema": "https://raw.githubusercontent.com/nicolo-ribaudo/oxlint-json-schema/refs/heads/main/.oxlintrc.json",
  "plugins": ["typescript", "unicorn", "oxc", "react", "nextjs", "import"],
  "jsPlugins": ["./packages/v2/react/eslint-rules/copilotkit-plugin.mjs"],
  "categories": {
    "correctness": "warn",
    "suspicious": "warn"
  },
  "rules": {
    "copilotkit/require-cpk-prefix": "warn"
  },
  "overrides": [
    {
      "files": ["**/__tests__/**", "**/*.test.*", "**/*.spec.*"],
      "rules": {
        "copilotkit/require-cpk-prefix": "off"
      }
    }
  ],
  "ignorePatterns": [
    "dist/**",
    "node_modules/**",
    ".next/**",
    ".nuxt/**",
    "coverage/**",
    "storybook-static/**",
    "**/@generated/**",
    "docs/**"
  ]
}
```

**Step 3: Create the oxlint JS plugin wrapper**

Create `packages/v2/react/eslint-rules/copilotkit-plugin.mjs`:

```javascript
import requireCpkPrefix from "./require-cpk-prefix.mjs";

const plugin = {
  meta: { name: "copilotkit" },
  rules: {
    "require-cpk-prefix": requireCpkPrefix,
  },
};

export default plugin;
```

The existing `require-cpk-prefix.mjs` already exports the rule in ESLint-compatible format — it should work with
oxlint's JS plugin support as-is.

**Step 4: Verify oxlint loads the config**

```bash
npx oxlint --print-config
```

Expected: Prints merged config showing the plugins and rules.

**Step 5: Verify oxfmt works**

```bash
npx oxfmt --check .
```

Expected: Runs without crashing (may report formatting differences — that's fine).

**Step 6: Commit**

```
chore: add oxlint and oxfmt configuration files
```

---

### Task 3: Update all package.json lint scripts

**Files:**

- Modify: `package.json` (root — scripts)
- Modify: `packages/v2/agent/package.json`
- Modify: `packages/v2/angular/package.json`
- Modify: `packages/v2/core/package.json`
- Modify: `packages/v2/demo-agents/package.json`
- Modify: `packages/v2/react/package.json`
- Modify: `packages/v2/runtime/package.json`
- Modify: `packages/v2/shared/package.json`
- Modify: `packages/v2/sqlite-runner/package.json`
- Modify: `packages/v2/voice/package.json`
- Modify: `packages/v2/web-inspector/package.json`
- Modify: `examples/v1/chat-with-your-data/package.json`
- Modify: `examples/v1/state-machine/package.json`
- Modify: `examples/v2/react/demo/package.json`
- Modify: `scripts/qa/lib/firebase/package.json`
- Modify: Various example package.json files with `next lint`

**Step 1: Update root package.json scripts**

Change:

```json
{
  "lint": "nx run-many -t lint --projects=packages/**",
  "format": "prettier --write \"**/*.{ts,tsx,md}\"",
  "check-prettier": "prettier --check \"**/*.{ts,tsx,md}\""
}
```

To:

```json
{
  "lint": "nx run-many -t lint --projects=packages/**",
  "format": "oxfmt --write .",
  "check-format": "oxfmt --check ."
}
```

Note: The `check-prettier` script is renamed to `check-format` for consistency. The CI workflow will be updated to match
in Task 5.

**Step 2: Update all V2 package.json lint scripts**

For all packages in `packages/v2/*/package.json`, change:

```json
"lint": "eslint ."
```

To:

```json
"lint": "oxlint ."
```

Special case — `packages/v2/voice/package.json` has:

```json
"lint": "eslint . --max-warnings 0"
```

Change to:

```json
"lint": "oxlint . --deny-warnings"
```

**Step 3: Update example package.json lint scripts**

For examples with `"lint": "eslint ."` or `"lint": "eslint \"src/**/*.{js,jsx,ts,tsx}\" \"*.{js,cjs,mjs,ts}\""`: Change
to:

```json
"lint": "oxlint ."
```

For examples with `"lint": "next lint"`: Change to:

```json
"lint": "oxlint ."
```

For `scripts/qa/lib/firebase/package.json`:

```json
"lint": "eslint --ext .js,.ts ."
```

Change to:

```json
"lint": "oxlint ."
```

**Step 4: Verify lint runs**

```bash
npx oxlint .
```

Expected: Runs and outputs lint results (warnings/errors are fine for now — we just need it to not crash).

**Step 5: Commit**

```
chore: update all lint/format scripts to use oxlint/oxfmt
```

---

### Task 4: Delete all ESLint and Prettier config files

**Files to DELETE:**

**V2 eslint config package (entire directory):**

- `packages/v2/eslint-config/package.json`
- `packages/v2/eslint-config/base.js`
- `packages/v2/eslint-config/react-internal.js`
- `packages/v2/eslint-config/next.js`

**V1 eslint config package (entire directory):**

- `packages/v1/eslint-config-custom/package.json`
- `packages/v1/eslint-config-custom/index.js`

**V2 package eslint configs:**

- `packages/v2/agent/eslint.config.mjs`
- `packages/v2/angular/eslint.config.mjs`
- `packages/v2/core/eslint.config.mjs`
- `packages/v2/demo-agents/eslint.config.mjs`
- `packages/v2/react/eslint.config.mjs`
- `packages/v2/runtime/eslint.config.mjs`
- `packages/v2/shared/eslint.config.mjs`
- `packages/v2/sqlite-runner/eslint.config.mjs`
- `packages/v2/voice/eslint.config.mjs`
- `packages/v2/web-inspector/eslint.config.mjs`

**V1 package eslint configs:**

- `packages/v1/runtime/.eslintrc.js`
- `packages/v1/a2ui-renderer/eslint.config.js`

**Example eslint configs:**

- `examples/v1/next-openai/.eslintrc.js`
- `examples/v1/next-pages-router/.eslintrc.js`
- `examples/v1/node-express/.eslintrc.js`
- `examples/v1/node-http/.eslintrc.js`
- `examples/v1/research-canvas/.eslintrc.json`
- `examples/v1/travel/.eslintrc.json`
- `examples/v1/chat-with-your-data/eslint.config.mjs`
- `examples/v1/form-filling/eslint.config.mjs`
- `examples/v1/state-machine/eslint.config.mjs`
- `examples/v1/_legacy/copilot-anthropic-pinecone/.eslintrc.json`
- `examples/v1/_legacy/copilot-openai-mongodb-atlas-vector-search/.eslintrc.json`
- `examples/v1/_legacy/copilot-fully-custom/eslint.config.mjs`
- `examples/v2/react/demo/eslint.config.mjs`
- `examples/v2/interrupts-langgraph/eslint.config.mjs`
- `examples/v2/interrupts-langgraph/apps/web/eslint.config.mjs`

**Other eslint configs:**

- `src/v1.x/.eslintrc.js`
- `docs/eslint.config.mjs`

**Prettier configs:**

- `src/v1.x/.prettierrc`
- `src/v2.x/.prettierrc`
- `src/v1.x/.prettierignore`
- `docs/.prettierignore`

**Step 1: Delete all files listed above**

```bash
# V2 eslint-config package
rm -rf packages/v2/eslint-config/

# V1 eslint-config-custom package
rm -rf packages/v1/eslint-config-custom/

# V2 package eslint configs
rm -f packages/v2/*/eslint.config.mjs

# V1 package eslint configs
rm -f packages/v1/runtime/.eslintrc.js
rm -f packages/v1/a2ui-renderer/eslint.config.js

# Example eslint configs (legacy format)
rm -f examples/v1/next-openai/.eslintrc.js
rm -f examples/v1/next-pages-router/.eslintrc.js
rm -f examples/v1/node-express/.eslintrc.js
rm -f examples/v1/node-http/.eslintrc.js
rm -f examples/v1/research-canvas/.eslintrc.json
rm -f examples/v1/travel/.eslintrc.json
rm -f examples/v1/_legacy/copilot-anthropic-pinecone/.eslintrc.json
rm -f examples/v1/_legacy/copilot-openai-mongodb-atlas-vector-search/.eslintrc.json

# Example eslint configs (flat format)
rm -f examples/v1/chat-with-your-data/eslint.config.mjs
rm -f examples/v1/form-filling/eslint.config.mjs
rm -f examples/v1/state-machine/eslint.config.mjs
rm -f examples/v1/_legacy/copilot-fully-custom/eslint.config.mjs
rm -f examples/v2/react/demo/eslint.config.mjs
rm -f examples/v2/interrupts-langgraph/eslint.config.mjs
rm -f examples/v2/interrupts-langgraph/apps/web/eslint.config.mjs

# Other
rm -f src/v1.x/.eslintrc.js
rm -f docs/eslint.config.mjs

# Prettier configs
rm -f src/v1.x/.prettierrc
rm -f src/v2.x/.prettierrc
rm -f src/v1.x/.prettierignore
rm -f docs/.prettierignore
```

**Step 2: Remove the eslint-config packages from pnpm workspace**

Check `pnpm-workspace.yaml` — if these packages are explicitly listed, remove them. They're likely picked up by glob
patterns like `packages/v2/*` so deleting the directories should suffice.

**Step 3: Verify no eslint/prettier configs remain**

```bash
find . -name ".eslintrc*" -not -path "*/node_modules/*" 2>/dev/null
find . -name "eslint.config.*" -not -path "*/node_modules/*" 2>/dev/null
find . -name ".prettierrc*" -not -path "*/node_modules/*" 2>/dev/null
find . -name ".prettierignore" -not -path "*/node_modules/*" 2>/dev/null
```

Expected: No results (all config files removed).

**Step 4: Commit**

```
chore: remove all eslint and prettier config files
```

---

### Task 5: Update CI workflow and git hooks

**Files:**

- Modify: `.github/workflows/static_quality.yml`
- Modify: `lefthook.yml`

**Step 1: Update the CI workflow**

Replace the `prettier` and `eslint` jobs in `.github/workflows/static_quality.yml`:

```yaml
name: static / quality

on:
  push:
    branches: [main]
    paths-ignore:
      - "docs/**"
      - "README.md"
      - "examples/**"
      - ".github/workflows/demos_preview.yml"
      - ".github/workflows/release.yml"
      - "packages/v1/**/package.json"
      - "packages/v1/**/CHANGELOG.md"
      - ".changeset/**"
  pull_request:
    branches: [main]
    paths-ignore:
      - "docs/**"
      - "README.md"
      - "examples/**"
      - ".changeset/**"

env:
  NODE_OPTIONS: "--max-old-space-size=4096"

jobs:
  format:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v3

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: "10.13.1"

      - name: Install uv
        uses: astral-sh/setup-uv@v6

      - name: Use Node.js 20
        uses: actions/setup-node@v3
        with:
          node-version: 20.x
          cache: "pnpm"
          cache-dependency-path: "**/pnpm-lock.yaml"

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run format check
        run: pnpm run check-format

  oxlint:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v3

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: "10.13.1"

      - name: Setup uv
        uses: astral-sh/setup-uv@v6

      - name: Use Node.js 20
        uses: actions/setup-node@v3
        with:
          node-version: 20.x
          cache: "pnpm"
          cache-dependency-path: "**/pnpm-lock.yaml"

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run oxlint check
        run: pnpm run lint

  package-quality:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v3

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: "10.13.1"

      - name: Install uv
        uses: astral-sh/setup-uv@v6

      - name: Use Node.js 20
        uses: actions/setup-node@v3
        with:
          node-version: 20.x
          cache: "pnpm"
          cache-dependency-path: "**/pnpm-lock.yaml"

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run publint and attw
        run: pnpm run check:packages
```

**Step 2: Update lefthook.yml**

The pre-commit hook currently runs:

```yaml
lint-fix:
  tags: lint
  run: pnpm run lint --fix && pnpm run format
  stage_fixed: true
```

The `pnpm run lint` and `pnpm run format` scripts are already updated (Task 3), so the underlying tools change
automatically. However, `oxlint` uses `--fix` the same way, and `oxfmt --write .` is the default behavior, so
`pnpm run format` will work as-is.

No changes needed to lefthook.yml — the scripts it calls are already updated.

**Step 3: Verify CI commands locally**

```bash
pnpm run check-format
pnpm run lint
```

Expected: Both run without crashing.

**Step 4: Commit**

```
chore: update CI workflow for oxlint/oxfmt
```

---

### Task 6: Clean up remaining ESLint/Prettier references

**Step 1: Search for any remaining references**

```bash
grep -r "eslint" --include="*.json" --include="*.yml" --include="*.yaml" --include="*.js" --include="*.mjs" --include="*.ts" --include="*.md" . \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.next --exclude-dir=.git \
  --exclude-dir=coverage -l
```

Look for:

- `eslint` references in package.json `devDependencies` (should all be gone)
- `eslint-disable` comments in source code → change to `oxlint-disable` (or leave — oxlint may honor `eslint-disable`
  comments for compatibility)
- References in README or docs to ESLint/Prettier → update if in the main repo docs

```bash
grep -r "prettier" --include="*.json" --include="*.yml" --include="*.yaml" --include="*.js" --include="*.mjs" --include="*.ts" . \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.next --exclude-dir=.git \
  --exclude-dir=coverage -l
```

**Step 2: Check for eslint-disable comments in source**

oxlint supports both `eslint-disable` and `oxlint-disable` comment directives. No changes strictly needed, but
optionally migrate them for consistency.

**Step 3: Run pnpm install to clean up lockfile**

```bash
pnpm install
```

**Step 4: Verify everything works end-to-end**

```bash
pnpm run lint
pnpm run check-format
```

Expected: Both commands complete successfully.

**Step 5: Commit**

```
chore: clean up remaining eslint/prettier references
```

---

### Task 7: Final verification and format the codebase

**Step 1: Run oxfmt to format the entire codebase**

```bash
pnpm run format
```

This will reformat all files according to the new oxfmt config. Review the diff to ensure it looks reasonable.

**Step 2: Run oxlint on the full codebase**

```bash
pnpm run lint
```

Review any warnings/errors. Adjust `.oxlintrc.json` rules if needed (e.g., turn off noisy rules that weren't previously
enabled).

**Step 3: Commit formatting changes separately**

```
style: reformat codebase with oxfmt
```

**Step 4: Final commit for any rule adjustments**

If `.oxlintrc.json` needed tweaks:

```
chore: tune oxlint rules after initial run
```
