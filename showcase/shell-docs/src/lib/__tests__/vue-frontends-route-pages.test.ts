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
  expect(headless).toContain("resolveInterrupt");
  expect(headless).toContain("cancelInterrupt");
});

test("the Vue thread routes stay on the Intelligence-backed path unless the user owns persistence", () => {
  const threads = sourceFor("frontends/vue/threads");
  const drawer = sourceFor("frontends/vue/prebuilt-components/copilot-threads-drawer");
  const headlessThreads = sourceFor("frontends/vue/headless-threads");
  const selfManaged = sourceFor("frontends/vue/threads-self-managed");

  expect(threads).toContain("CopilotKit Intelligence");
  expect(drawer).toContain("CopilotThreadsDrawer");
  expect(headlessThreads).toContain("useThreads");
  expect(selfManaged).toContain("useThreads()");
  expect(selfManaged).toContain("your own database");
});

