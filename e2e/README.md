# CopilotKit E2E Testing (Simplified)

Modern, automated end-to-end testing for CopilotKit applications using **auto-discovery** and **local development**.

## 🚀 Quick Start

```bash
# 1. Install dependencies
cd e2e
pnpm install
pnpm exec playwright install --with-deps

# 2. Validate setup
pnpm validate

# 3. Set up environment
export OPENAI_API_KEY=sk-your-key-here
export TAVILY_API_KEY=your-tavily-key  # For research apps

# 4. Start all apps
pnpm start-apps

# 5. In another terminal - run tests
pnpm test
```

## 🏗️ Architecture

### 1. **Auto-Discovery Script** (`scripts/start-test-apps.sh`)

- Automatically finds apps in `e2e/example-apps/*` and whitelisted `examples/coagents/*`
- Links local CopilotKit packages (both NPM and Python SDK)
- Starts agents (Python) and UIs (Next.js) on unique ports
- Outputs environment variables for Playwright consumption
- CLI interface with `--list`, `--print-env`, specific app selection

### 2. **Environment Variables** (No more config complexity!)

```bash
# Example output:
RESEARCH_CANVAS_URL=http://localhost:3001
QA_TEXT_URL=http://localhost:3002
QA_NATIVE_URL=http://localhost:3003
ROUTING_URL=http://localhost:3004
TRAVEL_URL=http://localhost:3005
```

### 3. **Simplified Playwright Tests**

- Use environment variables instead of config objects
- Each test file is standalone and focused
- No complex nested describe loops
- Direct URL construction with query parameters

## 📁 Test Structure

### **Individual Test Files (New Simple Approach):**

```
tests/
├── qa-native.openai.spec.ts        # QA Native + OpenAI
├── qa-native.anthropic.spec.ts     # QA Native + Anthropic
├── qa-text.openai.spec.ts          # QA Text + OpenAI
├── qa-text.anthropic.spec.ts       # QA Text + Anthropic
├── research-canvas.openai.spec.ts  # Research + OpenAI
├── research-canvas.anthropic.spec.ts # Research + Anthropic
├── routing.openai.spec.ts          # Routing + OpenAI
├── routing.anthropic.spec.ts       # Routing + Anthropic
├── travel-demo.openai.spec.ts      # Travel + OpenAI
└── travel-demo.anthropic.spec.ts   # Travel + Anthropic
```

### **Legacy Complex Files (To be removed):**

```
tests/
├── coagents-canvas-researcher-demo.spec.ts  # ❌ Complex AWS-style
├── coagents-qa-native-demo.spec.ts         # ❌ Complex AWS-style
├── coagents-qa-text-demo.spec.ts           # ❌ Complex AWS-style
├── coagents-routing-demo.spec.ts           # ❌ Complex AWS-style
└── next-openai.spec.ts                     # ❌ Complex AWS-style
```

## 🔧 Commands

```bash
# List available apps
pnpm list-apps

# Start specific apps only
pnpm start-specific research-canvas travel

# Print environment variables
./scripts/start-test-apps.sh --print-env

# Validate entire setup
pnpm validate

# Run tests (simplified)
pnpm test

# Debug single test
pnpm test:debug research-canvas.openai.spec.ts
```

## ✅ Benefits of New Architecture

### **Before (Complex AWS-style):**

```typescript
// ❌ Massive complexity
const allConfigs = getConfigs();
const qaConfigs = filterConfigsByProject(
  allConfigs,
  PROJECT_NAMES.COAGENTS_QA_NATIVE
);
const groupedConfigs = groupConfigsByDescription(qaConfigs);

Object.entries(groupedConfigs).forEach(([projectName, descriptions]) => {
  test.describe(`${projectName}`, () => {
    Object.entries(descriptions).forEach(([description, configs]) => {
      configs.forEach((config) => {
        variants.forEach((variant) => {
          test(`Complex test ${variant.name}`, async ({ page }) => {
            await page.goto(`${config.url}${variant.queryParams}`);
            // ... test logic
          });
        });
      });
    });
  });
});
```

### **After (Simple & Direct):**

```typescript
// ✅ Clean and obvious
test.describe("QA Native - OpenAI", () => {
  test("should handle email workflow", async ({ page }) => {
    const url = process.env.QA_NATIVE_URL || "http://localhost:3003";
    await page.goto(`${url}?coAgentsModel=openai`);
    // ... test logic
  });
});
```

## 🎯 Adding New Apps

### **For apps in `e2e/example-apps/`:**

1. Just add your app directory - it's **auto-discovered**
2. Create test files: `your-app.openai.spec.ts`, `your-app.anthropic.spec.ts`

### **For apps in `examples/coagents/`:**

1. Add your app name to `WHITELIST_MAIN_EXAMPLES` in the startup script
2. Create test files following the naming convention

## 🚀 GitHub Actions Integration

The same workflow runs in CI - no special cloud configuration needed:

```yaml
- name: Start Apps
  run: cd e2e && ./scripts/start-test-apps.sh &

- name: Run Tests
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  run: cd e2e && pnpm test

- name: Upload Videos (on failure)
  if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: playwright-videos
    path: e2e/test-results/
```

## 🎥 Video Recording & Artifacts

- **Videos** recorded automatically on test failures (`retain-on-failure`)
- **Traces** captured for debugging (`on-first-retry`)
- **HTML reports** generated for GitHub Actions artifacts
- **GitHub-native storage** - no AWS S3 needed!

---

**Result: E2E testing that's actually maintainable! 🎉**
