import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export function useMcpAppsSuggestions() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Draw a flowchart",
        message: "Use Excalidraw to draw a simple flowchart with three steps.",
      },
      {
        title: "Sketch a system diagram",
        message:
          "Open Excalidraw and sketch a system diagram with a client, server, and database.",
      },
    ],
    available: "always",
  });
}
