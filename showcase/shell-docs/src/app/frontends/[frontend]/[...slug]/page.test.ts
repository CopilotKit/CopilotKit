import { describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";

const navigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: navigation.redirect,
  notFound: navigation.notFound,
}));

import FrontendDocPage from "./page";

const redirectMock = vi.mocked(redirect);

function callFrontendDocPage(frontend: string, slug: string[]) {
  return FrontendDocPage({
    params: Promise.resolve({ frontend, slug }),
  });
}

describe("legacy frontend docs route", () => {
  it("canonicalizes React guidance docs to the React root", async () => {
    await expect(
      callFrontendDocPage("react", ["using-these-docs"]),
    ).rejects.toThrow("NEXT_REDIRECT:/");

    expect(redirectMock).toHaveBeenCalledWith("/");
  });
});
