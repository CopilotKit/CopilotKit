import { expect, test, vi } from "vitest";

const clerkMiddlewareCalls = vi.hoisted(
  () => [] as Array<Record<string, unknown> | undefined>,
);

vi.mock("@clerk/nextjs/server", () => ({
  clerkMiddleware: (_handler: unknown, options?: Record<string, unknown>) => {
    clerkMiddlewareCalls.push(options);
    return vi.fn();
  },
}));

vi.mock("@/data/registry.json", () => ({
  default: { integrations: [] },
}));

test("configures Clerk auto-sync for the Docs middleware", async () => {
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
    await import("./middleware");

    expect(clerkMiddlewareCalls).toEqual([
      {
        isSatellite: true,
        domain: "docs.staging.copilotkit.ai",
        signInUrl: "https://dashboard.staging.operations.copilotkit.ai/sign-in",
        signUpUrl:
          "https://dashboard.staging.operations.copilotkit.ai/sign-in/sign-up",
        satelliteAutoSync: true,
      },
    ]);
  } finally {
    vi.unstubAllEnvs();
  }
});
