/**
 * Suggestion pills shown in the chat UI. Each suggestion triggers a specific
 * demo feature when clicked.
 *
 * Ordered from most constrained (fixed UI) to most open (freeform UI).
 *
 * Showcase mode (showcase.json) controls which pills are visually highlighted.
 * Highlight styling: globals.css (.a2ui-highlight, .opengenui-highlight)
 * A2UI agent tools: agent/src/a2ui_fixed_schema.py, a2ui_dynamic_schema.py
 * A2UI catalog: src/app/declarative-generative-ui/
 */
import { useConfigureSuggestions } from "@copilotkit/react-core/v2";
import showcaseConfig from "../showcase.json";

const showcase = showcaseConfig.showcase;

export const useExampleSuggestions = () => {
  // canonical e2e pill — see showcase/aimock/_canonical-catalog.json
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Pasta night",
        message: "suggest a vegetarian pasta dinner for four guests",
        className: showcase === "a2ui" ? "a2ui-highlight" : undefined,
      },
    ],
    available: "always",
  });
};
