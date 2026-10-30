import { describe, expect, it } from "vitest";
import {
  buildGenerativeUIMarkdownGuidelines,
  generativeUIGuideFeatures,
  GENERATIVE_UI_MARKDOWN_GUIDELINES,
  GENERATIVE_UI_MARKDOWN_GUIDELINES_DESCRIPTION,
  GENERATIVE_UI_MARKDOWN_SCHEMA_CONTEXT_DESCRIPTION,
  GENERATIVE_UI_MARKDOWN_WHEN_TO_SHOW,
  GENERATIVE_UI_WHEN_TO_SHOW,
} from "../a2ui-prompts";
import { COPILOTKIT_FUNCTIONS } from "../generative-ui/basic-functions";
import { buildGenerativeUIPrompt } from "../generative-ui/prompt";
import { GENERATIVE_UI_AGENT_FUNCTION_CALLS } from "../generative-ui/types";

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
    expect(guide).toContain('Keep "dataModel" flat');
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

  it("describes function values and the formatString grammar", () => {
    expect(guide).toContain(
      'A prop can also be a function value that updates with the data: {"@call":"formatCurrency"',
    );
    expect(guide).toContain(
      'Use only the functions under "functions" in the schema.',
    );
    expect(guide).toContain("formatString interpolates ${...}");
    expect(guide).toContain(
      "Inside formatString, ${...} does not support operators",
    );
    expect(guide).toContain(
      '{"@call":"calc","args":{"expression":"seats * 29 * (annual ? 0.8 : 1)"',
    );
    expect(guide).toContain(
      'use series. Its description under "functions" in the schema',
    );
    expect(guide).toContain('the "items" of a List');
    expect(guide).not.toContain("template path of a list");
    expect(guide).toContain('{"@call":"@index","args":{"offset":1}}');
  });

  it("describes checks with the validator functions", () => {
    expect(guide).toContain('Validate an input with "checks"');
    expect(guide).toContain("required, regex, length, numeric and email");
    expect(guide).toContain("disables a Button that has the same checks");
  });

  it("describes slots with child ids and with a template of relative paths", () => {
    expect(guide).toContain('"tabs":[{"title":"Specs","child":"specs"}]');
    expect(guide).toContain('"children":["a","b"]');
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

  it.skipIf(GENERATIVE_UI_AGENT_FUNCTION_CALLS)(
    "does not mention callRendererFunction while the agent path is off",
    () => {
      expect(guide).not.toContain("callRendererFunction");
      expect(guide).not.toContain("rendererFunctionResponse");
    },
  );

  it.skipIf(!GENERATIVE_UI_AGENT_FUNCTION_CALLS)(
    "describes callRendererFunction, its unique id, and the developer-message response",
    () => {
      expect(guide).toContain(
        '{"version":"v1.0","callRendererFunction":{"functionCallId":"<unique id>","callFunction":{"@call":"<function>","args":{...}}}}',
      );
      expect(guide).toContain(
        "Give every callRendererFunction a new functionCallId.",
      );
      expect(guide).toContain('"callers": "UI or agent" or "agent only"');
      expect(guide).toContain(
        '{"version":"v1.0","rendererFunctionResponse":{"functionCallId":"<id>","value":...}}',
      );
      expect(guide).toContain("Then you get a new turn.");
    },
  );

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
    ).toEqual({
      functions: true,
      events: true,
      templates: true,
      checks: false,
    });
  });

  it("finds none when the components have no events or multiple slots and no function is mounted", () => {
    expect(
      generativeUIGuideFeatures({
        components: {
          Card: { props, slots: { child: "single" }, events: {} },
        },
        functions: {},
      }),
    ).toEqual({
      functions: false,
      events: false,
      templates: false,
      checks: false,
    });
  });
});

describe("buildGenerativeUIMarkdownGuidelines", () => {
  const none = {
    functions: false,
    events: false,
    templates: false,
    checks: false,
  };

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
    expect(small).not.toContain('"checks"');
    expect(small).toContain("Never wrap the whole reply in a fence.");
    expect(small.length).toBeLessThan(GENERATIVE_UI_MARKDOWN_GUIDELINES.length);
  });

  it("keeps events and openUrl, but no app functions, when none is mounted", () => {
    const text = buildGenerativeUIMarkdownGuidelines({ ...none, events: true });
    expect(text).toContain("userMessage");
    expect(text).toContain('"@call":"openUrl"');
    expect(text).not.toContain("an app function from the schema");
    expect(text).not.toContain("callRendererFunction");
  });

  it("adds the checks rule for a component with a checks prop", () => {
    const text = buildGenerativeUIMarkdownGuidelines({ ...none, checks: true });
    expect(text).toContain('Validate an input with "checks"');
    expect(
      generativeUIGuideFeatures({
        components: {
          TextField: {
            props: {
              type: "object",
              properties: { checks: { type: "array" } },
            },
          },
        },
        functions: {},
      }).checks,
    ).toBe(true);
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

describe("GENERATIVE_UI_WHEN_TO_SHOW", () => {
  it("guides the markdown transport with its own text: UI by task, prose for quick answers", () => {
    expect(GENERATIVE_UI_MARKDOWN_WHEN_TO_SHOW).toContain(
      "Match the UI to the task",
    );
    expect(GENERATIVE_UI_MARKDOWN_WHEN_TO_SHOW).toContain(
      "prose alone only for",
    );
    expect(GENERATIVE_UI_MARKDOWN_WHEN_TO_SHOW).toContain("No decoration");
    expect(buildGenerativeUIMarkdownGuidelines()).toContain(
      GENERATIVE_UI_MARKDOWN_WHEN_TO_SHOW,
    );
  });

  it("encourages UI where it conveys the answer better, and prose otherwise, in the tool transport", () => {
    expect(GENERATIVE_UI_WHEN_TO_SHOW).toContain("illustrate a concept");
    expect(GENERATIVE_UI_WHEN_TO_SHOW).toContain("prose alone");
    expect(GENERATIVE_UI_WHEN_TO_SHOW).toContain("decoration");
    expect(
      buildGenerativeUIPrompt({
        catalogId: "test",
        targets: [],
        components: {},
        functions: {},
        surfaces: {},
      }),
    ).toContain(GENERATIVE_UI_WHEN_TO_SHOW);
  });
});

describe("computed data guidance", () => {
  const series = COPILOTKIT_FUNCTIONS.series;
  const markdownGuide = buildGenerativeUIMarkdownGuidelines();
  const toolPrompt = buildGenerativeUIPrompt({
    catalogId: "test",
    targets: [],
    components: {},
    functions: {
      series: {
        description: series.description,
        parameters: { type: "object", description: series.parameters },
        returnType: series.returnType,
      },
    },
    surfaces: {},
  });

  it("the series description carries the rules and the example", () => {
    expect(series.description).toContain('"month":"${i}"');
    expect(series.description).toContain(
      '"monthlyCost":{"@path":"/monthlyCost"}',
    );
    expect(series.description).toContain(
      "whole-expression string retains the result type",
    );
    expect(series.description).toContain("resolve before the series loop");
    expect(series.description).not.toContain('"variable":"m"');
    expect(series.description).not.toContain("WORKAROUND");
    expect(series.description).not.toContain("a2ui-agent-sdk");
  });

  it.each([
    ["markdown", markdownGuide],
    ["tool", toolPrompt],
  ])(
    "points to series and scopes ${...} in the %s transport",
    (_transport, prompt) => {
      expect(prompt).toContain(
        "For a computed list (chart data, template items) use series. Its description under",
      );
      expect(prompt).toContain(
        "${...} is evaluated only in the value of formatString and in the item of series",
      );
      expect(prompt).toContain(
        "Inside formatString, ${...} does not support operators",
      );
      expect(prompt).not.toContain('"variable":"m"');
      expect(prompt).not.toContain("There are no operators in ${...}");
    },
  );

  it("gives the series description once, in the function list of the tool prompt", () => {
    expect(toolPrompt.split(series.description)).toHaveLength(2);
  });

  it("leaves the series description to the schema in the markdown guide", () => {
    expect(markdownGuide).not.toContain(series.description);
  });
});
