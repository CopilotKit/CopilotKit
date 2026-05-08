import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

// Suggestion `message` strings double as deterministic aimock fixture keys.
// Keep them short, distinctive, and aligned with the fixture entries in
// `showcase/aimock/d5-all.json` so each pill click produces a stable
// `generateSandboxedUi` tool call (rather than getting absorbed by a
// generic catch-all fixture). Titles below the message use the same
// short label so the pill copy reads as a natural human prompt.
const minimalSuggestions = [
  {
    title: "3D axis visualization",
    message: "3D axis visualization (model airplane)",
  },
  {
    title: "How a neural network works",
    message: "How a neural network works",
  },
  {
    title: "Quicksort visualization",
    message: "Quicksort visualization",
  },
  {
    title: "Fourier: square wave from sines",
    message: "Fourier: square wave from sines",
  },
];

export function useOpenGenUISuggestions() {
  useConfigureSuggestions({
    suggestions: minimalSuggestions,
    available: "always",
  });
}
