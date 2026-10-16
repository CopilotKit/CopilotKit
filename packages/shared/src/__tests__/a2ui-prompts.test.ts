import { describe, expect, it } from "vitest";
import {
  GENERATIVE_UI_MARKDOWN_GUIDELINES,
  GENERATIVE_UI_MARKDOWN_GUIDELINES_DESCRIPTION,
  GENERATIVE_UI_MARKDOWN_SCHEMA_CONTEXT_DESCRIPTION,
} from "../a2ui-prompts";

const guide = GENERATIVE_UI_MARKDOWN_GUIDELINES;

describe("GENERATIVE_UI_MARKDOWN_GUIDELINES", () => {
  it("tells the model to write fences, and never to call a tool", () => {
    expect(guide).toContain("```a2ui");
    expect(guide).not.toContain("render_ui");
    expect(guide).not.toContain("render_a2ui");
  });

  it("places a fence in the chat or in a named target", () => {
    expect(guide).toContain(
      "Open a fence with ```a2ui to show the surface in the chat, at the place of the fence.",
    );
    expect(guide).toContain(
      "Open a fence with ```a2ui target=<id> to show the surface in a named target.",
    );
  });

  it("asks for one JSON object per line, each with the v0.9 version and the catalog id", () => {
    expect(guide).toContain("write one JSON object per line and nothing else");
    expect(guide).toContain('Give every operation "version":"v0.9".');
    expect(guide).toContain(
      "Set catalogId in createSurface to the catalog id from the schema.",
    );
  });

  it("asks for createSurface, then the data model, then the root component first", () => {
    expect(guide).toContain(
      'createSurface, then updateDataModel with all the initial data, then updateComponents with the "root" component first',
    );
    expect(guide.indexOf("updateDataModel")).toBeLessThan(
      guide.indexOf("updateComponents"),
    );
  });

  it("keeps components flat, which live models got wrong", () => {
    expect(guide).toContain(
      'Put the component name in "component" (never "type")',
    );
    expect(guide).toContain('never inside a "props" object');
  });

  it("describes path bindings for data and for writable inputs", () => {
    expect(guide).toContain('bind it to the data model with {"path":"/x"}');
    expect(guide).toContain(
      'Bind a writable prop to let the user edit it: "value":{"path":"/form/email"}.',
    );
  });

  it("describes both event bindings and that an unbound button does nothing", () => {
    expect(guide).toContain('{"event":{"name":"<name>","context":{...}}}');
    expect(guide).toContain(
      '{"functionCall":{"call":"<function>","args":{...}}}',
    );
    expect(guide).toContain('Never a flat {"event":"<name>"}.');
    expect(guide).toContain(
      "A button or other event prop without an event or functionCall does nothing.",
    );
  });

  it("keeps function calls and expressions out of data props", () => {
    expect(guide).toContain(
      'Never put {"call": ...} or an expression in a data prop.',
    );
  });

  it("describes slots with child ids and with a template of relative paths", () => {
    expect(guide).toContain('"children":["a","b"] for a multiple slot');
    expect(guide).toContain('"children":{"componentId":"row","path":"/items"}');
    expect(guide).toContain(
      'paths are relative to the item ("name", not "/name")',
    );
  });

  it("updates a surface from a later fence with the same surfaceId, also in a later reply", () => {
    expect(guide).toContain(
      "write another fence with the same surfaceId, in this reply or in a later reply.",
    );
  });

  it("keeps prose outside the fences and Card for interactive panels", () => {
    expect(guide).toContain("Never make a surface that is only prose.");
    expect(guide).toContain("Use Card only for an interactive panel");
    expect(guide).toContain("Never wrap the whole reply in a fence.");
  });
});

describe("markdown context entry descriptions", () => {
  it("names the schema entry differently from the a2ui-middleware schema key", () => {
    // The LangGraph and Strands adapters move an entry with this exact
    // description out of the prompt and into the render_a2ui tool state.
    expect(GENERATIVE_UI_MARKDOWN_SCHEMA_CONTEXT_DESCRIPTION).not.toBe(
      "A2UI Component Schema — available components for generating UI surfaces. Use these component names and properties when creating A2UI operations.",
    );
    expect(GENERATIVE_UI_MARKDOWN_SCHEMA_CONTEXT_DESCRIPTION).not.toBe(
      GENERATIVE_UI_MARKDOWN_GUIDELINES_DESCRIPTION,
    );
  });
});
