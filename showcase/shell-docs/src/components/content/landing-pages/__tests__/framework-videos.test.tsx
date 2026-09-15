// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { FrameworkVideos } from "../framework-videos";

afterEach(cleanup);
const videos = [
  { title: "Overview", url: "https://example.com/overview.mp4" },
  { title: "Shared state", url: "https://example.com/state.mp4" },
];

it("reveals native controls after metadata loads and switches the selected video", () => {
  render(<FrameworkVideos videos={videos} />);
  const first = screen.getByLabelText(
    "Overview — CopilotKit product walkthrough",
  );
  fireEvent.loadedMetadata(first);
  expect(screen.queryByRole("status")).toBeNull();
  expect(first.hasAttribute("controls")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Shared state" }));
  expect(
    screen
      .getByLabelText("Shared state — CopilotKit product walkthrough")
      .getAttribute("src"),
  ).toContain("state.mp4");
  expect(
    screen
      .getByRole("button", { name: "Shared state" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(screen.getByRole("status").textContent).toContain("Loading");
});

it("offers the original video when an embed fails", () => {
  render(<FrameworkVideos videos={videos} />);
  fireEvent.error(
    screen.getByLabelText("Overview — CopilotKit product walkthrough"),
  );
  expect(screen.getByRole("status").textContent).toContain("couldn’t load");
  expect(
    screen.getByRole("link", { name: "Open video" }).getAttribute("href"),
  ).toBe(videos[0].url);
});
