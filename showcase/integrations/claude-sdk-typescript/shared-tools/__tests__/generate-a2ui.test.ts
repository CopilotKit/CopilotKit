import { describe, it, expect, vi } from "vitest";
import {
  generateA2uiImpl,
  buildA2uiOperationsFromToolCall,
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
  it("builds createSurface + updateComponents in v0.9 nested format", () => {
    const result = buildA2uiOperationsFromToolCall({
      surfaceId: "s1",
      catalogId: "cat1",
      components: [{ id: "root", component: "Title" }],
    });
    expect(result.a2ui_operations).toHaveLength(2);
    expect(result.a2ui_operations[0]).toMatchObject({
      version: "v0.9",
      createSurface: { surfaceId: "s1", catalogId: "cat1" },
    });
    expect(result.a2ui_operations[1]).toMatchObject({
      version: "v0.9",
      updateComponents: { surfaceId: "s1" },
    });
  });

  it("includes updateDataModel when data provided", () => {
    const result = buildA2uiOperationsFromToolCall({
      surfaceId: "s1",
      catalogId: "cat1",
      components: [{ id: "root" }],
      data: { key: "value" },
    });
    expect(result.a2ui_operations).toHaveLength(3);
    expect(result.a2ui_operations[2]).toMatchObject({
      version: "v0.9",
      updateDataModel: { surfaceId: "s1", path: "/", value: { key: "value" } },
    });
  });

  it("defaults surfaceId and catalogId", () => {
    const result = buildA2uiOperationsFromToolCall({ components: [] });
    const op0 = result.a2ui_operations[0] as {
      version: string;
      createSurface: { surfaceId: string; catalogId: string };
    };
    expect(op0.createSurface.surfaceId).toBe("dynamic-surface");
    expect(op0.createSurface.catalogId).toBe(CUSTOM_CATALOG_ID);
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

// Anti-drift parity guard. The TS builder MUST emit the same v0.9 NESTED
// operation shape as the Python source of truth in
// showcase/shared/python/tools/generate_a2ui.py
// (build_a2ui_operations_from_tool_call). A2UI consumers process operations
// by their nested createSurface/updateComponents/updateDataModel keys; the
// legacy FLAT shape (`{ type: "create_surface", surfaceId }`) is not
// processed as a valid nested operation, so the surface's schema and
// components are never applied. This test would have caught the Python/TS
// drift: it FAILS against the flat builder and PASSES against the nested one.
describe("buildA2uiOperationsFromToolCall v0.9 nested-shape parity guard", () => {
  it("emits the nested v0.9 shape and NEVER the legacy flat `type` shape", () => {
    const { a2ui_operations: ops } = buildA2uiOperationsFromToolCall({
      surfaceId: "s1",
      catalogId: "cat1",
      components: [{ id: "root", component: "Title" }],
      data: { key: "value" },
    });

    // Every op carries the version tag and one nested operation key —
    // and NONE of them carry the flat `type` discriminator.
    for (const op of ops) {
      const record = op as Record<string, unknown>;
      expect(record.version).toBe("v0.9");
      expect(record.type).toBeUndefined();
      expect(record).not.toHaveProperty("type");
    }

    // Exact nested keys, mirroring generate_a2ui.py's op list.
    expect(ops[0]).toMatchObject({
      version: "v0.9",
      createSurface: { surfaceId: "s1", catalogId: "cat1" },
    });
    expect(ops[1]).toMatchObject({
      version: "v0.9",
      updateComponents: {
        surfaceId: "s1",
        components: [{ id: "root", component: "Title" }],
      },
    });
    expect(ops[2]).toMatchObject({
      version: "v0.9",
      updateDataModel: { surfaceId: "s1", path: "/", value: { key: "value" } },
    });

    // Explicit negative assertions on the exact legacy flat literals so a
    // regression to the old shape fails loudly rather than silently.
    expect(JSON.stringify(ops)).not.toContain('"type":"create_surface"');
    expect(JSON.stringify(ops)).not.toContain('"type":"update_components"');
    expect(JSON.stringify(ops)).not.toContain('"type":"update_data_model"');
  });
});

// Empty-data parity guard. Python uses `if data:`, so an empty dict `{}`
// (falsy in Python) emits NO updateDataModel op. TS previously used a bare
// `if (data)`, and `{}` is truthy in JS — that emitted a spurious
// updateDataModel with `value: {}`, diverging from Python on our own mastra
// fixture (showcase/aimock/d6/mastra/gen-ui-a2ui-fixed.json records
// `"data": {}`). The builder now only emits updateDataModel for a non-empty
// object, matching Python.
describe("buildA2uiOperationsFromToolCall empty-data parity guard", () => {
  it("omits updateDataModel when data is an empty object `{}`", () => {
    const { a2ui_operations: ops } = buildA2uiOperationsFromToolCall({
      surfaceId: "s1",
      catalogId: "cat1",
      components: [{ id: "root", component: "Title" }],
      data: {},
    });

    expect(ops).toHaveLength(2);
    expect(
      ops.some((op) => "updateDataModel" in (op as Record<string, unknown>)),
    ).toBe(false);
    expect(ops[0]).toMatchObject({
      version: "v0.9",
      createSurface: { surfaceId: "s1" },
    });
    expect(ops[1]).toMatchObject({
      version: "v0.9",
      updateComponents: { surfaceId: "s1" },
    });
  });

  it("omits updateDataModel when data is absent", () => {
    const { a2ui_operations: ops } = buildA2uiOperationsFromToolCall({
      surfaceId: "s1",
      catalogId: "cat1",
      components: [{ id: "root", component: "Title" }],
    });

    // A builder that wrongly emitted updateDataModel for absent data would
    // produce 3 ops; asserting exactly 2 nested ops (and their keys) makes
    // this a meaningful count guard rather than a vacuous membership check.
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({
      version: "v0.9",
      createSurface: { surfaceId: "s1" },
    });
    expect(ops[1]).toMatchObject({
      version: "v0.9",
      updateComponents: { surfaceId: "s1" },
    });
  });
});
