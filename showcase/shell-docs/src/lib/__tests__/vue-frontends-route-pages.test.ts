import { readFileSync } from "node:fs";

import { expect, test } from "vitest";

import { loadDoc } from "../docs-render";

function sourceFor(route: string) {
  const doc = loadDoc(route);
  expect(doc, route).not.toBeNull();
  return readFileSync(doc!.filePath, "utf8");
}

test("the Vue tool-registration routes keep composables in descendant components", () => {
  const toolBased = sourceFor("frontends/vue/generative-ui/tool-based");
  const frontendTools = sourceFor("frontends/vue/frontend-tools");
  const programmatic = sourceFor("frontends/vue/programmatic-control");

  for (const source of [toolBased, frontendTools, programmatic]) {
    expect(source).toContain("src/components/");
    expect(source).toContain("src/App.vue");
    expect(source).toContain("CopilotKitProvider");
  }
});

test("the Vue interrupt routes keep the runtime and slot paths explicit", () => {
  const interrupt = sourceFor("frontends/vue/human-in-the-loop/useInterrupt");
  const headless = sourceFor("frontends/vue/human-in-the-loop/headless");

  expect(interrupt).toContain("#interrupt");
  expect(interrupt).toContain("renderInChat: false");
  expect(headless).toContain("renderInChat: false");
  expect(interrupt).not.toContain("resolveInterrupt");
  expect(interrupt).not.toContain("cancelInterrupt");
  expect(headless).toContain("slotProps.resolve");
  expect(headless).toContain("slotProps.cancel");
});

test("the Vue shared-state routes keep read/write state separate from read-only context", () => {
  const sharedState = sourceFor("frontends/vue/shared-state");
  const rendering = sourceFor("frontends/vue/shared-state/rendering-in-app");
  const readOnly = sourceFor("frontends/vue/shared-state/agent-readonly");

  expect(sharedState).toContain("current.setState");
  expect(sharedState).toContain("separate read-only capability");
  expect(rendering).toContain("currentAgent.setState");
  expect(readOnly).toContain("useAgentContext");
});

test("the framework-neutral thread routes reuse the canonical shared pages", () => {
  const threads = sourceFor("threads");
  const threadsImport = sourceFor("threads-import");
  const drawer = sourceFor(
    "frontends/vue/prebuilt-components/copilot-threads-drawer",
  );
  const headlessThreads = sourceFor("frontends/vue/headless-threads");
  const selfManaged = sourceFor("frontends/vue/threads-self-managed");

  expect(loadDoc("frontends/vue/threads")).toBeNull();
  expect(loadDoc("frontends/vue/threads-import")).toBeNull();
  expect(threads).toContain("@/snippets/shared/threads/overview.mdx");
  expect(threadsImport).toContain(
    "@/snippets/shared/threads/threads-import.mdx",
  );
  expect(drawer).toContain("CopilotThreadsDrawer");
  expect(headlessThreads).toContain("useThreads");
  expect(selfManaged).toContain("useThreads()");
  expect(selfManaged).toContain("my own database");
});

test("the Vue docs point Vue-owned routes at the explicit /vue path", () => {
  const headlessThreads = sourceFor("frontends/vue/headless-threads");
  const threadsLifecycle = sourceFor("frontends/vue/threads-lifecycle");
  const drawer = sourceFor(
    "frontends/vue/prebuilt-components/copilot-threads-drawer",
  );
  const selfManaged = sourceFor("frontends/vue/threads-self-managed");
  const sharedState = sourceFor("frontends/vue/shared-state");
  const sharedStateRendering = sourceFor(
    "frontends/vue/shared-state/rendering-in-app",
  );
  const sharedStateReadOnly = sourceFor(
    "frontends/vue/shared-state/agent-readonly",
  );
  const sharedStateStreaming = sourceFor(
    "frontends/vue/shared-state/streaming",
  );
  const toolBased = sourceFor("frontends/vue/generative-ui/tool-based");
  const programmatic = sourceFor("frontends/vue/programmatic-control");
  const hitlIndex = sourceFor("frontends/vue/human-in-the-loop/index");

  expect(headlessThreads).toContain(
    "/vue/prebuilt-components/copilot-threads-drawer",
  );
  expect(headlessThreads).toContain("/vue/threads-lifecycle");
  expect(threadsLifecycle).toContain("/vue/headless-threads");
  expect(drawer).toContain("/vue/headless-threads");
  expect(drawer).toContain("/vue/threads-lifecycle");
  expect(selfManaged).toContain(
    "/vue/prebuilt-components/copilot-threads-drawer",
  );
  expect(selfManaged).toContain("/vue/threads-lifecycle");
  expect(sharedState).toContain("/vue/shared-state/rendering-in-app");
  expect(sharedState).toContain("/vue/shared-state/streaming");
  expect(sharedState).toContain("/vue/shared-state/agent-readonly");
  expect(sharedStateRendering).toContain("/vue/shared-state");
  expect(sharedStateRendering).toContain("/vue/shared-state/streaming");
  expect(sharedStateRendering).toContain("/vue/shared-state/agent-readonly");
  expect(sharedStateReadOnly).toContain("/vue/shared-state");
  expect(sharedStateReadOnly).toContain("/vue/shared-state/streaming");
  expect(sharedStateStreaming).toContain("/vue/shared-state");
  expect(sharedStateStreaming).toContain("/vue/shared-state/agent-readonly");
  expect(toolBased).toContain("/vue/generative-ui/tool-rendering");
  expect(toolBased).toContain("/vue/human-in-the-loop");
  expect(programmatic).toContain("/vue/custom-look-and-feel/headless-ui");
  expect(hitlIndex).toContain("/vue/human-in-the-loop/useInterrupt");
  expect(hitlIndex).toContain("/vue/human-in-the-loop/headless");

  for (const source of [
    headlessThreads,
    threadsLifecycle,
    drawer,
    selfManaged,
    sharedState,
    sharedStateRendering,
    sharedStateReadOnly,
    sharedStateStreaming,
    toolBased,
    programmatic,
    hitlIndex,
  ]) {
    expect(source).not.toContain(
      "](/prebuilt-components/copilot-threads-drawer",
    );
    expect(source).not.toContain("](/headless-threads");
    expect(source).not.toContain("](/threads-lifecycle");
    expect(source).not.toContain("](/shared-state/");
    expect(source).not.toContain("](/human-in-the-loop/");
  }
});
