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

test("Angular Open Inspector step links the Angular install page first", () => {
  const step = read(
    "snippets/shared/inspector/open-inspector-step-angular.mdx",
  );

  expect(step).toContain("[Inspector for Angular](/angular/inspector)");
  expect(step).toContain("Open **Agents**, then **Agent**");
  expect(step).toContain("AG-UI Events");
  expect(step).toContain("Enable Intelligence");
  expect(step).not.toContain("/frontends/angular");
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

test("Intelligence signup CTA still names Inspector beside the Open Inspector step", () => {
  const langgraph = read("docs/integrations/langgraph/quickstart.mdx");
  const deepAgents = read("docs/integrations/deepagents/quickstart.mdx");

  for (const source of [langgraph, deepAgents]) {
    expect(source).toContain("<OpsPlatformCTA");
    expect(source.toLowerCase()).toContain("inspector");
    expect(source).toContain("<OpenInspectorStep");
  }
});

test("Vue and Angular getting-started pages include the Open Inspector step", () => {
  const vue = read("docs/frontends/vue.mdx");
  const angular = read("docs/frontends/angular.mdx");

  expect(vue).toContain("open-inspector-step.mdx");
  expect(vue).toContain("<OpenInspectorStep");
  expect(vue).toContain('show-dev-console="auto"');
  expect(angular).toContain("open-inspector-step-angular.mdx");
  expect(angular).toContain("<OpenInspectorStepAngular");
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

test("Inspector Callout snippets name the shipped pane and skip unshipped work", () => {
  const snippets = listMdx(SNIPPETS_DIR);
  expect(snippets.length).toBeGreaterThan(0);

  for (const path of snippets) {
    const source = readFileSync(path, "utf8");
    expect(source).not.toMatch(/\bPlayground\b/);
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

// Skipping the Open Inspector step keeps the docs from pointing React Native at a surface
// it has no way to open, but silence was its own defect: a mobile developer reads the
// Inspector as the debugging story everywhere else, finds nothing, and concludes the wiring
// is broken. A run that reached a fully working native app on 2026-08-25 hit exactly this
// (OSS-977). Both pages now state the absence rather than leaving the reader to infer it.
test("Inspector states that it needs a browser and React Native has none", () => {
  const inspector = read("docs/inspector.mdx");

  expect(inspector).toContain("## Where Inspector runs");
  expect(inspector).toContain("Inspector is a browser overlay");
  expect(inspector).toContain("There is no React Native build of Inspector");

  // Naming the gap without naming the substitutes moves the cost rather than removing it.
  expect(inspector).toContain("copilotkit verify --round-trip");
  expect(inspector).toContain("/troubleshooting/event-inspector");
  expect(inspector).toContain("/react-native#proving-it-works");
});

test("the React Native page lists the missing Inspector among its limitations", () => {
  const reactNative = read("docs/frontends/react-native.mdx");

  // The limitations list is where a mobile developer checks what does not carry over, and
  // it named voice and the web-only hooks while staying silent on the Inspector.
  const limitationsAt = reactNative.indexOf("## Known limitations");
  const inspectorAt = reactNative.indexOf("**Inspector**");
  expect(limitationsAt).toBeGreaterThanOrEqual(0);
  expect(inspectorAt).toBeGreaterThan(limitationsAt);

  expect(reactNative).toContain("no React Native surface");
  expect(reactNative).toContain("[Inspector](/inspector#where-inspector-runs)");

  // `/cpk-debug-events` is a runtime HTTP route, so the AG-UI event stream is the one
  // Inspector pane a mobile developer can still reach. Saying so is the difference between
  // a limitation and a dead end.
  expect(reactNative).toContain(
    "[AG-UI Event Inspector](/troubleshooting/event-inspector)",
  );
});
