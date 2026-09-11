// @vitest-environment jsdom

import React from "react";
import { renderToString } from "react-dom/server";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { IntegrationGrid } from "../integration-grid";
import { RuntimeConfigProvider } from "@/lib/runtime-config.client";

vi.mock("../framework-provider", () => ({
  useFramework: () => ({ framework: undefined }),
}));

const CONFIG = {
  baseUrl: "https://docs.example.com",
  shellUrl: "https://showcase.example.com",
  intelligenceSignupUrl: "https://signup.example.com",
  posthogKey: "",
  posthogHost: "https://posthog.example.com",
  scarfPixelId: "",
  googleAnalyticsTrackingId: "",
  reb2bKey: "",
  reoKey: "",
  clerkPublishableKey: "",
};

afterEach(() => {
  delete (window as Window & { __SHOWCASE_CONFIG__?: typeof CONFIG })
    .__SHOWCASE_CONFIG__;
});

it("renders the resolved shell host in SSR HTML and after hydration", async () => {
  const tree = (
    <RuntimeConfigProvider config={CONFIG}>
      <IntegrationGrid />
    </RuntimeConfigProvider>
  );
  const ssr = renderToString(tree);
  expect(ssr).toContain("https://showcase.example.com/integrations");
  expect(ssr).not.toContain("ssr-placeholder.invalid");

  render(tree);

  await waitFor(() =>
    expect(screen.getByRole("link", { name: "Integrations" })).toHaveAttribute(
      "href",
      "https://showcase.example.com/integrations",
    ),
  );
});
