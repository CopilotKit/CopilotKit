import { AbstractAgent, HttpAgent } from "@ag-ui/client";
import { defineComponent, h, nextTick } from "vue";
import { describe, expect, it } from "vitest";
import { mountWithProvider } from "../../__tests__/utils/mount";
import { useAgent } from "../use-agent";

// Models an HttpAgent from another installed copy of @ag-ui/client.
class ForeignHttpAgent extends AbstractAgent {
  url = "https://agent.example";
  headers: Record<string, string> = {
    Authorization: "Bearer agent-token",
    "X-Agent": "agent",
  };
  abortController = new AbortController();

  run(): never {
    throw new Error("This test does not run the agent");
  }
}

describe("useAgent headers (Vue-specific semantics)", () => {
  it.each([
    [
      "HttpAgent",
      () =>
        new HttpAgent({
          url: "https://agent.example",
          headers: { Authorization: "Bearer agent-token", "X-Agent": "agent" },
        }),
    ],
    ["foreign HttpAgent", () => new ForeignHttpAgent()],
  ] as const)(
    "preserves %s headers when the provider changes headers",
    async (_name, createAgent) => {
      const agent = createAgent();
      let headersAfterHook: Record<string, string> | undefined;
      const Child = defineComponent({
        setup() {
          useAgent();
          headersAfterHook = { ...agent.headers };
          return () => null;
        },
      });
      const { wrapper } = mountWithProvider(() => h(Child), {
        runtimeUrl: undefined,
        agents__unsafe_dev_only: { default: agent },
        headers: { "X-Core": "initial" },
      });

      try {
        expect(headersAfterHook).toEqual({
          Authorization: "Bearer agent-token",
          "X-Agent": "agent",
          "X-Core": "initial",
        });
        expect(agent.headers).toEqual({
          Authorization: "Bearer agent-token",
          "X-Agent": "agent",
          "X-Core": "initial",
        });

        await wrapper.setProps({
          headers: { Authorization: "Bearer core-token", "X-Core": "updated" },
        });
        await nextTick();
        expect(agent.headers).toEqual({
          Authorization: "Bearer core-token",
          "X-Agent": "agent",
          "X-Core": "updated",
        });

        await wrapper.setProps({ headers: {} });
        await nextTick();
        expect(agent.headers).toEqual({
          Authorization: "Bearer agent-token",
          "X-Agent": "agent",
        });
      } finally {
        wrapper.unmount();
      }
    },
  );
});
