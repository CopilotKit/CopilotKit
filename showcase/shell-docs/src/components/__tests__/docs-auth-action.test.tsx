// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const clerkState = { isSignedIn: false };

vi.mock("@clerk/nextjs", () => {
  const UserButton = Object.assign(
    () => <button type="button">Account menu</button>,
    {
      MenuItems: () => null,
      Link: () => null,
    },
  );
  return {
    useUser: () => ({ isLoaded: true, isSignedIn: clerkState.isSignedIn }),
    UserButton,
  };
});

vi.mock("../public-clerk-provider", () => ({
  usePublicClerkAvailable: () => true,
  usePublicOpsUrl: () => "https://dashboard.operations.copilotkit.ai",
}));

import {
  DocsPublicAuthControl,
  useDocsAuthAction,
} from "../docs-public-auth-control";

function AuthLink() {
  const { href, label } = useDocsAuthAction();
  return <a href={href}>{label}</a>;
}

function AuthControl() {
  return <DocsPublicAuthControl fallback={<AuthLink />} />;
}

beforeEach(() => {
  window.localStorage.clear();
  clerkState.isSignedIn = false;
});

test("auth action changes from sign-up to sign-in after a browser signs in", async () => {
  const view = render(<AuthControl />);

  expect(
    screen.getByRole("link", { name: "Sign up" }).getAttribute("href"),
  ).toContain("/sign-up?");

  clerkState.isSignedIn = true;
  view.rerender(<AuthControl />);
  await waitFor(() => {
    expect(
      window.localStorage.getItem("copilotkit-docs-signed-in-before"),
    ).toBe("1");
  });
  expect(screen.getByRole("button", { name: "Account menu" })).toBeTruthy();

  clerkState.isSignedIn = false;
  view.rerender(<AuthControl />);
  expect(
    screen.getByRole("link", { name: "Sign in" }).getAttribute("href"),
  ).toContain("/sign-in?");
});
