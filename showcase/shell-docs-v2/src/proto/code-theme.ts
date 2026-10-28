/*
 * Code highlighting in the copilotkit.ai palette. Every token color clears
 * 4.5:1 on Fumadocs' code block surfaces in its theme (checked against the
 * frame grey and white in light, and the night frame and ground in dark).
 */
const scopes = (c: Record<string, string>) => [
  {
    scope: ["comment", "punctuation.definition.comment"],
    settings: { foreground: c.comment, fontStyle: "italic" },
  },
  {
    scope: [
      "keyword",
      "storage",
      "storage.type",
      "keyword.control",
      "keyword.operator.new",
      "keyword.operator.expression",
    ],
    settings: { foreground: c.keyword },
  },
  {
    scope: [
      "string",
      "string.quoted",
      "string.template",
      "punctuation.definition.string",
    ],
    settings: { foreground: c.string },
  },
  {
    scope: ["entity.name.function", "support.function", "meta.function-call"],
    settings: { foreground: c.fn },
  },
  {
    scope: [
      "entity.name.type",
      "entity.name.class",
      "support.type",
      "support.class",
      "entity.other.inherited-class",
    ],
    settings: { foreground: c.type },
  },
  {
    scope: [
      "constant.numeric",
      "constant.language",
      "constant.character",
      "variable.language",
    ],
    settings: { foreground: c.number },
  },
  {
    scope: ["entity.name.tag", "support.class.component"],
    settings: { foreground: c.tag },
  },
  { scope: ["entity.other.attribute-name"], settings: { foreground: c.attr } },
  {
    scope: ["punctuation", "meta.brace", "keyword.operator"],
    settings: { foreground: c.punctuation },
  },
  {
    scope: ["variable", "variable.other", "meta.object-literal.key"],
    settings: { foreground: c.fg },
  },
];

const light = {
  fg: "#010507", // ink
  comment: "#6b6b73",
  keyword: "#5057cc", // lilac ink
  string: "#11785b", // mint ink
  fn: "#1b70c4", // signal blue
  type: "#9a4f06", // brand orange, deepened (derived)
  number: "#b8323b", // brand red, deepened (derived)
  tag: "#5057cc",
  attr: "#8a5a00", // derived
  punctuation: "#57575b", // slate
};

const dark = {
  fg: "#ebebeb",
  comment: "#8f8f97",
  keyword: "#bec2ff", // lilac
  string: "#85ecce", // mint
  fn: "#8cb9f2",
  type: "#ffac4d", // orange
  number: "#fa8a90",
  tag: "#bec2ff",
  attr: "#ffd08a",
  punctuation: "#b8b8b8",
};

export const brandLight = {
  name: "copilotkit-light",
  type: "light" as const,
  colors: { "editor.foreground": light.fg, "editor.background": "#00000000" },
  tokenColors: scopes(light),
};

export const brandDark = {
  name: "copilotkit-dark",
  type: "dark" as const,
  colors: { "editor.foreground": dark.fg, "editor.background": "#00000000" },
  tokenColors: scopes(dark),
};
