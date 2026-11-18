import { render, screen } from "@testing-library/react";

export function placeholder() {
  // TODO(copilotkit-2.0): The Open Generative UI placeholder element (`open-generative-ui-placeholder`) was removed in 2.0. While the agent generates, the renderer shows `open-generative-ui-progress-overlay` with `open-generative-ui-spinner` in it. See https://docs.copilotkit.ai/migrate/generative-ui-2.0
  return screen.getByTestId("open-generative-ui-placeholder");
}

// TODO(copilotkit-2.0): The Open Generative UI placeholder element (`open-generative-ui-placeholder`) was removed in 2.0. While the agent generates, the renderer shows `open-generative-ui-progress-overlay` with `open-generative-ui-spinner` in it. See https://docs.copilotkit.ai/migrate/generative-ui-2.0
export const selector = '[data-testid="open-generative-ui-placeholder"]';
export { render };
