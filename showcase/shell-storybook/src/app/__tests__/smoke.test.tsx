import { render, screen } from "@testing-library/react";
import HomePage from "../page";

it("introduces the Showcase Storybook", () => {
  render(<HomePage />);
  expect(screen.getByText("Showcase Storybook")).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Which part of Showcase is yours?" }),
  ).toBeInTheDocument();
});
