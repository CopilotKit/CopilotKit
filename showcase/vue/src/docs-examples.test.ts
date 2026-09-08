import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileScript, parse } from "@vue/compiler-sfc";
import { flushPromises, mount } from "@vue/test-utils";
import ts from "typescript";
import * as Vue from "vue";
import { describe, expect, it, vi } from "vitest";

const content = resolve(__dirname, "../../shell-docs/src/content");

// Execute the published SFC, not a second implementation maintained by the test.
function exampleSource(path: string, title: string): string | undefined {
  const mdx = readFileSync(resolve(content, path), "utf8");
  const source = mdx
    .split(`\x60\x60\x60vue title="${title}"\n`)[1]
    ?.split("\x60\x60\x60")[0];
  if (source) return source;
  for (const match of mdx.matchAll(
    /import (\w+) from "@\/(snippets\/[^"\n]+)";/g,
  )) {
    if (mdx.includes(`<${match[1]} components={props.components} />`)) {
      const nested = exampleSource(match[2], title);
      if (nested) return nested;
    }
  }
}

function example(path: string, title: string, bindings = {}) {
  const source = exampleSource(path, title);
  if (!source) throw new Error(`Missing ${title} in ${path}`);
  const filename = resolve(content, path);
  const { descriptor } = parse(source, { filename });
  const script = compileScript(descriptor, { id: title, inlineTemplate: true });
  const { outputText } = ts.transpileModule(script.content, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const exports: { default?: Vue.Component } = {};
  const require = (name: string) => {
    if (name === "vue") return Vue;
    if (name === "@copilotkit/vue/v2") return bindings;
    throw new Error(`Unexpected example import: ${name}`);
  };
  new Function("require", "exports", "myApi", outputText)(
    require,
    exports,
    bindings,
  );
  if (!exports.default) throw new Error(`Missing component in ${title}`);
  return exports.default;
}

describe("Vue documentation examples", () => {
  for (const page of ["threads-self-managed", "threads-lifecycle"]) {
    it(`${page}: restores once per agent/thread identity, not message or run updates`, async () => {
      const setMessages = vi.fn();
      const agent = Vue.shallowRef({ setMessages });
      const getMessages = vi.fn().mockResolvedValue([]);
      const component = example(
        `docs/frontends/vue/${page}.mdx`,
        "src/components/RestoreHistory.vue",
        {
          useAgent: () => ({ agent }),
          getMessages,
        },
      );
      const wrapper = mount(component, { props: { threadId: "first" } });
      await flushPromises();
      expect(getMessages).toHaveBeenCalledTimes(1);
      // useAgent emits triggerRef for message/state/run-status changes.
      for (let update = 0; update < 3; update++) {
        Vue.triggerRef(agent);
        await flushPromises();
      }
      expect(getMessages).toHaveBeenCalledTimes(1);
      await wrapper.setProps({ threadId: "second" });
      await flushPromises();
      expect(getMessages).toHaveBeenCalledTimes(2);
      agent.value = { setMessages: vi.fn() };
      await flushPromises();
      expect(getMessages).toHaveBeenCalledTimes(3);
      wrapper.unmount();
    });

    it(`${page}: ignores a stale history response after switching threads or unmounting`, async () => {
      const setMessages = vi.fn();
      const agent = Vue.shallowRef({ setMessages });
      const pending = new Map<string, (messages: string[]) => void>();
      const getMessages = vi.fn(
        (id: string) =>
          new Promise<string[]>((fulfill) => pending.set(id, fulfill)),
      );
      const component = example(
        `docs/frontends/vue/${page}.mdx`,
        "src/components/RestoreHistory.vue",
        {
          useAgent: () => ({ agent }),
          getMessages,
        },
      );
      const wrapper = mount(component, { props: { threadId: "first" } });
      await wrapper.setProps({ threadId: "second" });
      pending.get("second")!(["new"]);
      await flushPromises();
      pending.get("first")!(["stale"]);
      await flushPromises();
      expect(setMessages.mock.calls).toEqual([[["new"]]]);
      await wrapper.setProps({ threadId: "third" });
      wrapper.unmount();
      pending.get("third")!(["unmounted"]);
      await flushPromises();
      expect(setMessages).toHaveBeenCalledTimes(1);
    });
  }

  const card = () =>
    example(
      "docs/frontends/vue/human-in-the-loop/governed-actions.mdx",
      "src/components/GovernedActionCard.vue",
    );
  for (const verdict of ["allow", "deny"] as const) {
    it(`automatically responds to ${verdict} without approval controls`, async () => {
      const respond = vi.fn().mockResolvedValue(undefined);
      const wrapper = mount(card(), {
        props: {
          args: { id: "action", reference: "policy", verdict },
          respond,
        },
      });
      await flushPromises();
      expect(wrapper.findAll("button")).toHaveLength(0);
      expect(respond.mock.calls).toEqual([
        [
          {
            approved: verdict === "allow",
            actionId: "action",
            reference: "policy",
          },
        ],
      ]);
      await wrapper.setProps({
        args: {
          id: "action",
          reference: "policy",
          verdict,
          summary: "Updated",
        },
      });
      expect(respond).toHaveBeenCalledTimes(1);
      wrapper.unmount();
    });
  }

  for (const approved of [true, false]) {
    it(`requires a user decision for require_approval (${approved})`, async () => {
      const respond = vi.fn().mockResolvedValue(undefined);
      const wrapper = mount(card(), {
        props: {
          args: {
            id: "action",
            reference: "policy",
            verdict: "require_approval",
          },
          respond,
        },
      });
      expect(respond).not.toHaveBeenCalled();
      await wrapper.findAll("button")[approved ? 0 : 1].trigger("click");
      expect(respond).toHaveBeenCalledWith({
        approved,
        actionId: "action",
        reference: "policy",
      });
      wrapper.unmount();
    });
  }

  it("waits for complete arguments and an executing callback", async () => {
    const respond = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(card(), {
      props: { args: { id: "action" }, respond },
    });
    expect(wrapper.findAll("button")).toHaveLength(0);
    expect(respond).not.toHaveBeenCalled();
    await wrapper.setProps({
      args: { id: "action", reference: "policy", verdict: "deny" },
      respond: undefined,
    });
    expect(respond).not.toHaveBeenCalled();
    await wrapper.setProps({ respond });
    expect(respond).toHaveBeenCalledWith({
      approved: false,
      actionId: "action",
      reference: "policy",
    });
    wrapper.unmount();
  });
});
