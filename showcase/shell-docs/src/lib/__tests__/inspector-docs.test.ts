import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = resolve(here, "../../content");
const DOCS_DIR = join(CONTENT_DIR, "docs");
const SNIPPETS_DIR = join(CONTENT_DIR, "snippets/shared/inspector");
const PANE_MAP = resolve(
  here,
  "../../../../../skills/inspector-docs/references/pane-map.md",
);

function read(relativePath: string): string {
  return readFileSync(join(CONTENT_DIR, relativePath), "utf8");
}

function listMdx(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listMdx(path);
    return entry.name.endsWith(".mdx") ? [path] : [];
  });
}

function integrationQuickstarts(): string[] {
  const integrations = join(DOCS_DIR, "integrations");
  return readdirSync(integrations, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(integrations, entry.name, "quickstart.mdx"))
    .filter((path) => existsSync(path));
}

test("shared Open Inspector step names the three sanity checks", () => {
  const step = read("snippets/shared/inspector/open-inspector-step.mdx");

  expect(step).toContain("### Open Inspector and confirm setup");
  expect(step).toContain("Open **Agents**, then **Agent**");
  expect(step).toContain("AG-UI Events");
  expect(step).toContain("Enable Intelligence");
  expect(step).toContain("[Inspector](/inspector)");
});

test("Angular uses the shared Open Inspector step, not a manual-mount variant", () => {
  // @copilotkit/angular >= 0.4.0 depends on @copilotkit/web-inspector and mounts
  // cpk-web-inspector itself, so Angular is no longer a special case here.
  expect(
    existsSync(join(SNIPPETS_DIR, "open-inspector-step-angular.mdx")),
    "the Angular Open Inspector variant should stay deleted: Angular auto-mounts",
  ).toBe(false);
});

test("the Angular Inspector page does not teach a manual mount", () => {
  const page = read("docs/frontends/angular/inspector.mdx");

  // The claims that made this page a trap once Angular started auto-mounting.
  expect(page).not.toContain("does not depend on that package");
  expect(page).not.toContain(
    "npm install --save-dev @copilotkit/web-inspector",
  );
  expect(page).not.toContain("auto-attach-core");
  expect(page).not.toContain("document.createElement(WEB_INSPECTOR_TAG)");

  // What it must say instead.
  expect(page).toContain("mounts the Inspector for you");
  expect(page).toContain("[Inspector](/inspector)");
});

test("every web integration quickstart imports the Open Inspector step", () => {
  const quickstarts = [
    ...integrationQuickstarts(),
    join(DOCS_DIR, "agent-spec/quickstart.mdx"),
  ];

  expect(quickstarts.length).toBeGreaterThan(10);

  for (const path of quickstarts) {
    const source = readFileSync(path, "utf8");
    expect(
      source.includes("open-inspector-step.mdx"),
      `${path} must import the shared Open Inspector step`,
    ).toBe(true);
    expect(
      source.includes("<OpenInspectorStep"),
      `${path} must render the Open Inspector step`,
    ).toBe(true);
  }
});

test("Intelligence onboarding prompt appears beside the Open Inspector step", () => {
  const langgraph = read("docs/integrations/langgraph/quickstart.mdx");
  const deepAgents = read("docs/integrations/deepagents/quickstart.mdx");

  for (const source of [langgraph, deepAgents]) {
    expect(source).toContain("<IntelligenceOnboardingPrompt");
    expect(source).toContain('feature="learning"');
    expect(source.toLowerCase()).toContain("inspector");
    expect(source).toContain("<OpenInspectorStep");
  }
});

test("Vue and Angular getting-started pages include the Open Inspector step", () => {
  const vue = read("docs/frontends/vue.mdx");
  const angular = read("docs/frontends/angular.mdx");

  expect(vue).toContain("open-inspector-step.mdx");
  expect(vue).toContain("<OpenInspectorStep");
  expect(vue).not.toContain("show-dev-console");
  expect(angular).toContain("open-inspector-step.mdx");
  expect(angular).toContain("<OpenInspectorStep");
  expect(angular).not.toContain("open-inspector-step-angular");
});

test("mapped feature pages import the matching Inspector Callout", () => {
  expect(read("snippets/shared/threads/overview.mdx")).toContain(
    "open-inspector-pane-threads.mdx",
  );
  expect(read("docs/frontend-tools.mdx")).toContain(
    "open-inspector-pane-frontend-tools.mdx",
  );
  expect(read("docs/shared-state.mdx")).toContain(
    "open-inspector-pane-state.mdx",
  );
  expect(read("docs/shared-state/agent-readonly.mdx")).toContain(
    "open-inspector-pane-context.mdx",
  );
  expect(read("docs/human-in-the-loop/index.mdx")).toContain(
    "open-inspector-pane-frontend-tools.mdx",
  );
  expect(read("snippets/shared/premium/overview.mdx")).toContain(
    "open-inspector-pane-learning.mdx",
  );
});

test("Inspector Callout snippets name shipped panes and skip retired controls", () => {
  const snippets = listMdx(SNIPPETS_DIR);
  expect(snippets.length).toBeGreaterThan(0);

  for (const path of snippets) {
    const source = readFileSync(path, "utf8");
    expect(source).not.toMatch(/\bFork from here\b/);
    expect(source).not.toMatch(/\bEmit events\b/);
  }

  expect(
    read("snippets/shared/inspector/open-inspector-pane-frontend-tools.mdx"),
  ).toContain("Frontend Tools");
  expect(
    read("snippets/shared/inspector/open-inspector-pane-state.mdx"),
  ).toContain("**State**");
  expect(
    read("snippets/shared/inspector/open-inspector-pane-context.mdx"),
  ).toContain("**Context**");
  expect(
    read("snippets/shared/inspector/open-inspector-pane-learning.mdx"),
  ).toContain("**Learning**");
  expect(
    read("snippets/shared/inspector/open-inspector-pane-threads.mdx"),
  ).toContain("**Threads**");
});

test("pane map lists each shipped pane with a Callout or no page yet", () => {
  const paneMap = readFileSync(PANE_MAP, "utf8");

  for (const pane of [
    "Agent",
    "AG-UI Events",
    "Threads",
    "Frontend Tools",
    "State",
    "Context",
    "Learning",
    "Capabilities",
  ]) {
    expect(paneMap).toMatch(new RegExp(`\\|\\s*${pane}\\s*\\|`));
  }
  expect(paneMap).toContain("no page yet");
  expect(paneMap).toContain("Playground");
  expect(paneMap).toContain("React Native");
  expect(paneMap).toContain("Channels");
});

test("React Native and Channels do not tell the reader to click the Inspector button", () => {
  const reactNative = read("docs/frontends/react-native.mdx");
  const channels = read("docs/channels/index.mdx");

  expect(reactNative).not.toContain("click the Inspector button");
  expect(reactNative).not.toContain("OpenInspectorStep");
  expect(channels).not.toContain("click the Inspector button");
  expect(channels).not.toContain("OpenInspectorStep");
});

// Skipping the Open Inspector step kept the docs from pointing React Native at a surface it
// cannot open, but it never stated the absence. Both pages now say it (OSS-977).
test("Inspector states that it needs a browser and React Native has none", () => {
  const inspector = read("docs/inspector.mdx");

  expect(inspector).toContain("## Where Inspector runs");
  expect(inspector).toContain("Inspector is a browser overlay");
  expect(inspector).toContain("There is no React Native build of Inspector");

  // Naming the gap without naming the substitutes moves the cost rather than removing it.
  expect(inspector).toContain("copilotkit verify --round-trip");
  expect(inspector).toContain("/troubleshooting/debug-mode");
  expect(inspector).toContain("/react-native#proving-it-works");
});

test("the React Native page lists the missing Inspector among its limitations", () => {
  const reactNative = read("docs/frontends/react-native.mdx");

  // The limitations list is where a mobile developer checks what does not carry over.
  const limitationsAt = reactNative.indexOf("## Known limitations");
  const inspectorAt = reactNative.indexOf("**Inspector**");
  expect(limitationsAt).toBeGreaterThanOrEqual(0);
  expect(inspectorAt).toBeGreaterThan(limitationsAt);

  expect(reactNative).toContain("no React Native surface");
  expect(reactNative).toContain("[Inspector](/inspector#where-inspector-runs)");
  expect(reactNative).toContain("[Proving it works](#proving-it-works)");
});
