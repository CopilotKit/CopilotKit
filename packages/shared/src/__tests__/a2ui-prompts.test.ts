import { describe, expect, it } from "vitest";
import {
  buildGenerativeUIMarkdownGuidelines,
  generativeUIGuideFeatures,
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
    expect(guide).toContain(
      'When a target has "components", its surfaces can use only those components.',
    );
  });

  it("asks for one JSON object per line, each with the v1.0 version and no catalogId", () => {
    expect(guide).toContain("write one JSON object per line and nothing else");
    expect(guide).toContain('Give every operation "version":"v1.0".');
    expect(guide).not.toContain("v0.9");
    expect(guide).not.toContain("catalogId");
  });

  it("starts a surface with one createSurface that holds the data and the root, then streams the children", () => {
    expect(guide).toContain(
      'Start a surface with one createSurface. Put all the initial data in "dataModel" and the "root" component in "components".',
    );
    expect(guide).toContain(
      '{"version":"v1.0","createSurface":{"surfaceId":"plan-picker","dataModel":{ ...initial data... },"components":[{"id":"root"',
    );
    expect(guide.indexOf('"createSurface"')).toBeLessThan(
      guide.indexOf('"updateComponents"'),
    );
  });

  it("keeps components flat, which live models got wrong", () => {
    expect(guide).toContain(
      'Put the component name in "component" (never "type")',
    );
    expect(guide).toContain('never inside a "props" object');
  });

  it("describes @path bindings for data and for writable inputs, and forbids the path form", () => {
    expect(guide).toContain('bind it to the data model with {"@path":"/x"}');
    expect(guide).toContain('Never write {"path":"/x"} as a binding.');
    expect(guide).toContain(
      'Bind a writable prop to let the user edit it: "value":{"@path":"/form/email"}.',
    );
  });

  it("requires a value in updateDataModel and deletes with null", () => {
    expect(guide).toContain('Always give "value".');
    expect(guide).toContain('Set "value":null to delete the key at "path".');
  });

  it("describes events with userMessage, function calls with @call, and that an unbound button does nothing", () => {
    expect(guide).toContain(
      '{"event":{"name":"<name>","userMessage":"<text>","context":{...}}}',
    );
    expect(guide).toContain(
      '{"functionCall":{"@call":"<function>","args":{...}}}',
    );
    expect(guide).toContain(
      '{"event":{"name":"choose","userMessage":"Show me the Team plan"}}',
    );
    expect(guide).toContain('"context":{"email":{"@path":"/form/email"}}');
    expect(guide).toContain('Never a flat {"event":"<name>"}.');
    expect(guide).toContain(
      "A button or other event prop without an event or functionCall does nothing.",
    );
  });

  it("keeps function calls and expressions out of data props, except @index in a template", () => {
    expect(guide).toContain(
      'Never put {"@call": ...} or an expression in a data prop.',
    );
    expect(guide).toContain(
      'The only exception is {"@call":"@index"} in a template.',
    );
    expect(guide).toContain('{"@call":"@index","args":{"offset":1}}');
  });

  it("describes slots with child ids and with a template of relative paths", () => {
    expect(guide).toContain('"children":["a","b"] for a multiple slot');
    expect(guide).toContain('"children":{"componentId":"row","path":"/items"}');
    expect(guide).toContain(
      'paths are relative to the item ("name", not "/name")',
    );
  });

  it("updates a surface from a later fence with the same surfaceId in the reply, and a target from a later reply", () => {
    expect(guide).toContain(
      "To change a surface in this reply, write another fence with the same surfaceId.",
    );
    expect(guide).toContain(
      "A surface in a target can also be changed from a later reply; a chat surface cannot",
    );
    expect(guide).toContain(
      "Never use a surfaceId again, also after the surface is deleted.",
    );
  });

  it("describes callRendererFunction, its unique id, and the developer-message response", () => {
    expect(guide).toContain(
      '{"version":"v1.0","callRendererFunction":{"functionCallId":"<unique id>","callFunction":{"@call":"<function>","args":{...}}}}',
    );
    expect(guide).toContain(
      "Give every callRendererFunction a new functionCallId.",
    );
    expect(guide).toContain(
      '{"version":"v1.0","rendererFunctionResponse":{"functionCallId":"<id>","value":...}}',
    );
    expect(guide).toContain("Then you get a new turn.");
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

describe("generativeUIGuideFeatures", () => {
  const props = { type: "object", properties: {} };

  it("finds mounted functions, event props, and multiple slots", () => {
    expect(
      generativeUIGuideFeatures({
        components: {
          List: { props, slots: { items: "multiple" } },
          Button: { props, events: { onClick: { parameters: props } } },
        },
        functions: { save: { parameters: props } },
      }),
    ).toEqual({ functions: true, events: true, templates: true });
  });

  it("finds none when the components have no events or multiple slots and no function is mounted", () => {
    expect(
      generativeUIGuideFeatures({
        components: {
          Card: { props, slots: { child: "single" }, events: {} },
        },
        functions: {},
      }),
    ).toEqual({ functions: false, events: false, templates: false });
  });
});

describe("buildGenerativeUIMarkdownGuidelines", () => {
  const none = { functions: false, events: false, templates: false };

  it("has every rule group by default", () => {
    expect(buildGenerativeUIMarkdownGuidelines()).toBe(
      GENERATIVE_UI_MARKDOWN_GUIDELINES,
    );
  });

  it("leaves out the function, event, and template rules when they are off", () => {
    const small = buildGenerativeUIMarkdownGuidelines(none);
    expect(small).not.toContain("callRendererFunction");
    expect(small).not.toContain("functionCall");
    expect(small).not.toContain("userMessage");
    expect(small).not.toContain("@index");
    expect(small).toContain("Never wrap the whole reply in a fence.");
    expect(small.length).toBeLessThan(GENERATIVE_UI_MARKDOWN_GUIDELINES.length);
  });

  it("keeps events but drops the functionCall binding when no function is mounted", () => {
    const text = buildGenerativeUIMarkdownGuidelines({ ...none, events: true });
    expect(text).toContain("userMessage");
    expect(text).not.toContain("functionCall");
    expect(text).not.toContain("callRendererFunction");
  });

  it("adds the template and @index rules for a multiple slot", () => {
    const text = buildGenerativeUIMarkdownGuidelines({
      ...none,
      templates: true,
    });
    expect(text).toContain("@index");
    expect(text).toContain("componentId");
  });
});
