import { describe, it, expect } from "vitest";
import { ɵRendererRegistry } from "../renderer-registry";
import type { ɵRendererKind } from "../renderer-registry";

interface ToolEntry {
  name: string;
  agentId?: string;
  render: string;
}
interface ActivityEntry {
  activityType: string;
}
interface CustomEntry {
  render: string;
}

function createRegistry(toolCalls: ToolEntry[] = []) {
  const registry = new ɵRendererRegistry<ToolEntry, ActivityEntry, CustomEntry>(
    { toolCalls },
  );
  const changes: ɵRendererKind[] = [];
  registry.subscribe((kind) => changes.push(kind));
  return { registry, changes };
}

const propSearch: ToolEntry = { name: "search", render: "prop-search" };
const propWeather: ToolEntry = { name: "weather", render: "prop-weather" };

describe("ɵRendererRegistry tool calls", () => {
  it("returns the prop renderers when no hook renderer is registered", () => {
    const { registry } = createRegistry([propSearch, propWeather]);

    expect(registry.toolCalls.map((entry) => entry.render)).toEqual([
      "prop-search",
      "prop-weather",
    ]);
  });

  it("lets a hook renderer replace the prop renderer with the same key", () => {
    const { registry, changes } = createRegistry([propSearch, propWeather]);

    registry.addHookToolCall({ name: "search", render: "hook-search" });

    expect(registry.toolCalls.map((entry) => entry.render)).toEqual([
      "hook-search",
      "prop-weather",
    ]);
    expect(changes).toEqual(["toolCalls"]);
  });

  it("keeps renderers for the same name but different agents apart", () => {
    const { registry } = createRegistry([propSearch]);

    registry.addHookToolCall({
      name: "search",
      agentId: "research",
      render: "research-search",
    });

    expect(registry.toolCalls.map((entry) => entry.render)).toEqual([
      "prop-search",
      "research-search",
    ]);
  });

  it("lets the latest hook renderer for a key win", () => {
    const { registry } = createRegistry();

    registry.addHookToolCall({ name: "search", render: "first" });
    registry.addHookToolCall({ name: "search", render: "second" });

    expect(registry.toolCalls.map((entry) => entry.render)).toEqual(["second"]);
  });

  it("shows the prop renderer again after its hook replacement is removed", () => {
    const { registry, changes } = createRegistry([propSearch]);
    registry.addHookToolCall({ name: "search", render: "hook-search" });

    registry.removeHookToolCall("search");

    expect(registry.toolCalls.map((entry) => entry.render)).toEqual([
      "prop-search",
    ]);
    expect(changes).toEqual(["toolCalls", "toolCalls"]);
  });

  it("does not notify when removing a key that has no hook renderer", () => {
    const { registry, changes } = createRegistry([propSearch]);

    registry.removeHookToolCall("search");

    expect(changes).toEqual([]);
  });

  it("only removes through the returned function while that entry is current", () => {
    const { registry } = createRegistry();
    const removeFirst = registry.addHookToolCall({
      name: "search",
      render: "first",
    });
    registry.addHookToolCall({ name: "search", render: "second" });

    removeFirst();

    expect(registry.toolCalls.map((entry) => entry.render)).toEqual(["second"]);
  });

  it("keeps the same array until a list changes", () => {
    const { registry } = createRegistry([propSearch]);
    registry.addHookToolCall({ name: "weather", render: "hook-weather" });

    const first = registry.toolCalls;

    expect(registry.toolCalls).toBe(first);
    registry.addHookToolCall({ name: "maps", render: "hook-maps" });
    expect(registry.toolCalls).not.toBe(first);
  });

  it("copies the prop list so later changes to the caller's array do not leak in", () => {
    const props = [propSearch];
    const { registry } = createRegistry();
    registry.setPropToolCalls(props);

    props.push(propWeather);

    expect(registry.propToolCalls.map((entry) => entry.render)).toEqual([
      "prop-search",
    ]);
  });
});

describe("ɵRendererRegistry built-in tool calls", () => {
  const builtInA2UI: ToolEntry = {
    name: "render_a2ui",
    render: "built-in-a2ui",
  };

  it("keeps a built-in renderer when the prop renderers are replaced", () => {
    const { registry } = createRegistry([propSearch]);
    registry.addBuiltInToolCall(builtInA2UI);

    registry.setPropToolCalls([propSearch, propWeather]);

    expect(registry.toolCalls.map((entry) => entry.render)).toEqual([
      "prop-search",
      "prop-weather",
      "built-in-a2ui",
    ]);
  });

  it("keeps the prop renderers when a built-in renderer is added", () => {
    const { registry, changes } = createRegistry([propSearch]);

    registry.addBuiltInToolCall(builtInA2UI);

    expect(registry.toolCalls.map((entry) => entry.render)).toEqual([
      "prop-search",
      "built-in-a2ui",
    ]);
    expect(changes).toEqual(["toolCalls"]);
  });

  it("lets a prop or hook renderer with the same key win over a built-in one", () => {
    const { registry } = createRegistry([
      { name: "render_a2ui", render: "prop-a2ui" },
    ]);
    registry.addBuiltInToolCall(builtInA2UI);
    expect(registry.toolCalls.map((entry) => entry.render)).toEqual([
      "prop-a2ui",
    ]);

    registry.setPropToolCalls([]);
    registry.addHookToolCall({ name: "render_a2ui", render: "hook-a2ui" });
    expect(registry.toolCalls.map((entry) => entry.render)).toEqual([
      "hook-a2ui",
    ]);
  });

  it("keeps built-in renderers from different features apart", () => {
    const { registry } = createRegistry();
    registry.addBuiltInToolCall(builtInA2UI);
    const removeRenderUi = registry.addBuiltInToolCall({
      name: "render_ui",
      render: "built-in-render-ui",
    });

    removeRenderUi();

    expect(registry.toolCalls.map((entry) => entry.render)).toEqual([
      "built-in-a2ui",
    ]);
  });

  it("removes a built-in renderer only while it is the current one for its key", () => {
    const { registry } = createRegistry();
    const removeFirst = registry.addBuiltInToolCall(builtInA2UI);
    registry.addBuiltInToolCall({ name: "render_a2ui", render: "second" });

    removeFirst();

    expect(registry.toolCalls.map((entry) => entry.render)).toEqual(["second"]);
  });
});

describe("ɵRendererRegistry activity and custom renderers", () => {
  it("notifies with the kind of list that changed", () => {
    const { registry, changes } = createRegistry();

    registry.setActivity([{ activityType: "plan" }]);
    registry.setCustom([{ render: "banner" }]);

    expect(changes).toEqual(["activity", "custom"]);
    expect(registry.activity).toEqual([{ activityType: "plan" }]);
    expect(registry.custom).toEqual([{ render: "banner" }]);
  });

  it("stops notifying after unsubscribe", () => {
    const { registry } = createRegistry();
    const seen: ɵRendererKind[] = [];
    const stop = registry.subscribe((kind) => seen.push(kind));

    stop();
    registry.setCustom([{ render: "banner" }]);

    expect(seen).toEqual([]);
  });
});
