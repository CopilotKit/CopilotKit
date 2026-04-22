import { describe, it, expect, vi } from "vitest";
import {
  generateA2uiImpl,
  buildA2uiOperationsFromToolCall,
  RENDER_A2UI_TOOL_SCHEMA,
  CUSTOM_CATALOG_ID,
} from "../generate-a2ui";

describe("generateA2uiImpl", () => {
  it("returns system prompt from context entries", () => {
    const result = generateA2uiImpl({
      messages: [],
      contextEntries: [
        { value: "Component catalog info" },
        { value: "More context" },
      ],
    });
    expect(result.systemPrompt).toContain("Component catalog info");
    expect(result.systemPrompt).toContain("More context");
  });

  it("filters empty/missing context values", () => {
    const result = generateA2uiImpl({
      messages: [],
      contextEntries: [{ value: "" }, { noValue: true }, { value: "keep" }],
    });
    expect(result.systemPrompt).toBe("keep");
  });

  it("returns tool schema and choice", () => {
    const result = generateA2uiImpl({ messages: [] });
    expect(result.toolSchema.name).toBe("render_a2ui");
    expect(result.toolChoice).toBe("render_a2ui");
  });

  it("passes messages through", () => {
    const msgs = [{ role: "user", content: "hello" }];
    const result = generateA2uiImpl({ messages: msgs });
    expect(result.messages).toBe(msgs);
  });

  it("returns the default catalog ID", () => {
    const result = generateA2uiImpl({ messages: [] });
    expect(result.catalogId).toBe(CUSTOM_CATALOG_ID);
  });
});

describe("buildA2uiOperationsFromToolCall", () => {
  it("builds create_surface + update_components", () => {
    const result = buildA2uiOperationsFromToolCall({
      surfaceId: "s1",
      catalogId: "cat1",
      components: [{ id: "root", component: "Title" }],
    });
    expect(result.a2ui_operations).toHaveLength(2);
    expect(result.a2ui_operations[0].type).toBe("create_surface");
    expect(result.a2ui_operations[1].type).toBe("update_components");
  });

  it("includes update_data_model when data provided", () => {
    const result = buildA2uiOperationsFromToolCall({
      surfaceId: "s1",
      catalogId: "cat1",
      components: [{ id: "root" }],
      data: { key: "value" },
    });
    expect(result.a2ui_operations).toHaveLength(3);
    expect(result.a2ui_operations[2].type).toBe("update_data_model");
  });

  it("defaults surfaceId and catalogId", () => {
    const result = buildA2uiOperationsFromToolCall({ components: [] });
    expect(result.a2ui_operations[0].surfaceId).toBe("dynamic-surface");
    expect(result.a2ui_operations[0].catalogId).toBe(CUSTOM_CATALOG_ID);
  });

  it("warns on empty components", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    buildA2uiOperationsFromToolCall({
      surfaceId: "s1",
      catalogId: "c1",
      components: [],
    });
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("empty components"),
      "s1",
    );
    spy.mockRestore();
  });
});
