// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clerkProviderCalls = vi.hoisted(() => ({
  props: [] as Array<{
    publishableKey?: string;
    afterSignOutUrl?: string;
  }>,
}));

const navigation = vi.hoisted(() => ({
  pathname: "/react",
  searchParams: new URLSearchParams("utm_source=docs"),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => navigation.searchParams,
}));

vi.mock("@clerk/nextjs", () => ({
  ClerkProvider: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    publishableKey: string;
    afterSignOutUrl?: string;
  }) => {
    clerkProviderCalls.props.push(props);
    return <div data-testid="clerk-provider">{children}</div>;
  },
}));

import {
  PublicClerkProvider,
  usePublicClerkAvailable,
} from "../public-clerk-provider";
import { useDocsAuthEntryHref } from "../docs-public-auth-control";

function ProviderAvailabilityProbe() {
  const isAvailable = usePublicClerkAvailable();

  return <span>{isAvailable ? "available" : "unavailable"}</span>;
}

function AuthEntryHrefProbe() {
  const href = useDocsAuthEntryHref();

  return <a href={href}>Auth entry</a>;
}

function renderProvider(publishableKey = "pk_test_shell_docs") {
  return render(
    <PublicClerkProvider
      opsPublicUrl="https://dashboard.staging.operations.copilotkit.ai"
      publishableKey={publishableKey}
    >
      <ProviderAvailabilityProbe />
    </PublicClerkProvider>,
  );
}

beforeEach(() => {
  clerkProviderCalls.props = [];
  navigation.pathname = "/react";
  navigation.searchParams = new URLSearchParams("utm_source=docs");
  window.history.replaceState(null, "", "/react?utm_source=docs#intro");
});

afterEach(cleanup);

describe("PublicClerkProvider", () => {
  it("updates Clerk's sign-out return URL when the route changes", async () => {
    const { rerender } = renderProvider();

    expect(clerkProviderCalls.props.at(-1)).toMatchObject({
      publishableKey: "pk_test_shell_docs",
      afterSignOutUrl: "http://localhost:3000/react?utm_source=docs#intro",
    });
    expect(screen.getByText("available")).toBeTruthy();

    navigation.pathname = "/vue/quickstart";
    navigation.searchParams = new URLSearchParams("ref=nav");
    window.history.replaceState(null, "", "/vue/quickstart?ref=nav");

    rerender(
      <PublicClerkProvider
        opsPublicUrl="https://dashboard.staging.operations.copilotkit.ai"
        publishableKey="pk_test_shell_docs"
      >
        <ProviderAvailabilityProbe />
      </PublicClerkProvider>,
    );

    await waitFor(() =>
      expect(clerkProviderCalls.props.at(-1)).toMatchObject({
        publishableKey: "pk_test_shell_docs",
        afterSignOutUrl: "http://localhost:3000/vue/quickstart?ref=nav",
      }),
    );
  });

  it("skips Clerk and marks public auth unavailable without a publishable key", () => {
    renderProvider("");

    expect(clerkProviderCalls.props).toEqual([]);
    expect(screen.getByText("unavailable")).toBeTruthy();
  });

  it("builds auth entry links from the matching environment Ops origin", async () => {
    render(
      <PublicClerkProvider
        opsPublicUrl="https://dashboard.staging.operations.copilotkit.ai"
        publishableKey="pk_test_shell_docs"
      >
        <AuthEntryHrefProbe />
      </PublicClerkProvider>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "Auth entry" }).getAttribute("href"),
      ).toBe(
        "https://dashboard.staging.operations.copilotkit.ai/sign-in?post_auth_redirect=ready&utm_source=docs&utm_medium=cta&utm_campaign=intelligence&utm_content=navbar",
      ),
    );
  });
});
