// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, test, vi } from "vitest";

const clerkProviderCalls = vi.hoisted(
  () => [] as Array<Record<string, unknown>>,
);

vi.mock("next/navigation", () => ({
  usePathname: () => "/react",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@clerk/nextjs", () => ({
  ClerkProvider: ({ children, ...props }: { children: ReactNode }) => {
    clerkProviderCalls.push(props);
    return <>{children}</>;
  },
}));

test("configures public Docs as an auto-syncing Clerk satellite", async () => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_CLERK_IS_SATELLITE", "true");
  vi.stubEnv("NEXT_PUBLIC_CLERK_DOMAIN", "docs.staging.copilotkit.ai");
  vi.stubEnv(
    "NEXT_PUBLIC_CLERK_SIGN_IN_URL",
    "https://dashboard.staging.operations.copilotkit.ai/sign-in",
  );
  vi.stubEnv(
    "NEXT_PUBLIC_CLERK_SIGN_UP_URL",
    "https://dashboard.staging.operations.copilotkit.ai/sign-in/sign-up",
  );

  try {
    const { PublicClerkProvider } = await import("../public-clerk-provider");

    render(
      <PublicClerkProvider
        opsPublicUrl="https://dashboard.staging.operations.copilotkit.ai"
        publishableKey="pk_test_shell_docs"
      >
        <main>Public content</main>
      </PublicClerkProvider>,
    );

    expect(clerkProviderCalls.at(-1)).toMatchObject({
      isSatellite: true,
      domain: "docs.staging.copilotkit.ai",
      signInUrl: "https://dashboard.staging.operations.copilotkit.ai/sign-in",
      signUpUrl:
        "https://dashboard.staging.operations.copilotkit.ai/sign-in/sign-up",
      satelliteAutoSync: true,
    });
  } finally {
    cleanup();
    vi.unstubAllEnvs();
  }
});
