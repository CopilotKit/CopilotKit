import { afterEach, describe, expect, it, vi } from "vitest";
import { readCopilotKitUIEnvelope } from "@copilotkit/shared";
import {
  CapturingAgent,
  buttonSurface,
  envelopeOf,
  origin,
  runOnce,
  setup,
} from "./generative-ui.helpers";

afterEach(() => vi.restoreAllMocks());

describe("CopilotGenerativeUI", () => {
  describe("forwardEvent", () => {
    it("adds the event as a user message with the label of its component, then runs the agent", async () => {
      const { root, agent } = setup();
      root.manager.ingest(agent.threadId, "default", buttonSurface("s1"));

      const pending = root.forwardEvent(
        { name: "buy", ...origin, context: { sku: "a" } },
        "default",
      );
      await vi.waitFor(() => expect(CapturingAgent.inputs).toHaveLength(1));
      agent.start();
      agent.finish();

      await expect(pending).resolves.toEqual({ ok: true, result: undefined });
      expect(CapturingAgent.inputs[0]!.messages.at(-1)).toMatchObject({
        role: "user",
        content: "Buy now\n\nsku: a",
      });
    });

    it("sends the A2UI action message of the event in the envelope of its run, and not in the next run", async () => {
      const { root, agent, core } = setup();
      root.manager.ingest(agent.threadId, "default", buttonSurface("s1"));

      const pending = root.forwardEvent(
        {
          name: "buy",
          ...origin,
          timestamp: "2026-10-20T10:00:00.000Z",
          userMessage: "Buy it",
          context: { sku: "a" },
        },
        "default",
      );
      await vi.waitFor(() => expect(CapturingAgent.inputs).toHaveLength(1));
      const sent = envelopeOf(CapturingAgent.inputs[0]!);
      expect(sent?.metadata.extensions.copilotkit_action).toEqual({
        version: "v1.0",
        action: {
          name: "buy",
          surfaceId: "s1",
          sourceComponentId: origin.componentId,
          timestamp: "2026-10-20T10:00:00.000Z",
          userMessage: "Buy it",
          context: { sku: "a" },
        },
      });
      agent.start();
      // Another agent that runs in the meantime gets the envelope, but not
      // a click meant for this one.
      const elsewhere = readCopilotKitUIEnvelope(
        core.getPropertiesForAgent("other"),
      );
      expect(elsewhere?.["v1.0"].supportedCatalogIds).toEqual(["shop"]);
      expect(elsewhere?.metadata.extensions).not.toHaveProperty(
        "copilotkit_action",
      );
      agent.finish();
      await expect(pending).resolves.toEqual({ ok: true, result: undefined });

      // Once the run is over, a request that reads the properties with no
      // run start (a suggestion request, a follow-up) gets no action.
      await vi.waitFor(() =>
        expect(
          readCopilotKitUIEnvelope(core.getPropertiesForAgent("default"))
            ?.metadata.extensions,
        ).not.toHaveProperty("copilotkit_action"),
      );

      // A run that the user starts carries no action.
      const plain = envelopeOf(await runOnce(core, agent));
      expect(plain?.metadata.extensions).not.toHaveProperty(
        "copilotkit_action",
      );
    });

    it("sends the action of an event for another agent while this one runs", async () => {
      const { root, agent, other, core } = setup();
      // The first agent runs; its run start set the shared envelope.
      const first = core.runAgent({ agent });
      await vi.waitFor(() => expect(CapturingAgent.inputs).toHaveLength(1));
      agent.start();

      // A click for the other agent: its run gets no run-start notification
      // while the first one runs, and still carries its action.
      const pending = root.forwardEvent(
        { name: "pick", ...origin, context: { plan: "team" } },
        "other",
      );
      await vi.waitFor(() => expect(CapturingAgent.inputs).toHaveLength(2));
      const action = envelopeOf(CapturingAgent.inputs[1]!)?.metadata.extensions
        .copilotkit_action;
      expect(action?.action).toMatchObject({
        name: "pick",
        context: { plan: "team" },
      });
      // The first agent did not get it.
      expect(
        readCopilotKitUIEnvelope(core.getPropertiesForAgent("default"))
          ?.metadata.extensions,
      ).not.toHaveProperty("copilotkit_action");

      other.start();
      other.finish();
      // The action goes when the run ends, before any follow-up run; the
      // agent was not watched before, so the agent itself says so.
      await vi.waitFor(() =>
        expect(
          readCopilotKitUIEnvelope(core.getPropertiesForAgent("other"))
            ?.metadata.extensions,
        ).not.toHaveProperty("copilotkit_action"),
      );
      await expect(pending).resolves.toEqual({ ok: true, result: undefined });
      agent.finish();
      await first;
    });

    it("drops an event while the agent runs or another event is on its way, and takes the next one once idle", async () => {
      const { root, agent } = setup();
      root.manager.ingest(agent.threadId, "default", buttonSurface("s1"));
      const event = { name: "buy", ...origin, context: { sku: "a" } };

      // A double click: the second event arrives before the run has started.
      const first = root.forwardEvent(event, "default");
      const repeat = await root.forwardEvent(event, "default");
      expect(!repeat.ok && repeat.error.code).toBe("agent_busy");
      await vi.waitFor(() => expect(CapturingAgent.inputs).toHaveLength(1));
      agent.start();

      // A click while the reply streams.
      const midRun = await root.forwardEvent(event, "default");
      expect(!midRun.ok && midRun.error.code).toBe("agent_busy");
      agent.finish();
      await expect(first).resolves.toEqual({ ok: true, result: undefined });
      expect(CapturingAgent.inputs).toHaveLength(1);

      // Idle again: the next event is sent.
      const next = root.forwardEvent(event, "default");
      await vi.waitFor(() => expect(CapturingAgent.inputs).toHaveLength(2));
      agent.start();
      agent.finish();
      await expect(next).resolves.toEqual({ ok: true, result: undefined });
    });

    it("reports event_forward_failed when the agent does not exist", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const onError = vi.fn();
      const { root } = setup({ onError });

      const result = await root.forwardEvent(
        { name: "buy", ...origin, context: {} },
        "missing",
      );

      expect(!result.ok && result.error.code).toBe("event_forward_failed");
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "event", surfaceId: "s1" }),
      );
      expect(CapturingAgent.inputs).toHaveLength(0);
    });
  });
});
