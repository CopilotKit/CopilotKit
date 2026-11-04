import { render, screen } from "@testing-library/react";

export function placeholder() {
  return screen.getByTestId("open-generative-ui-placeholder");
}

export const selector = '[data-testid="open-generative-ui-placeholder"]';
export { render };
