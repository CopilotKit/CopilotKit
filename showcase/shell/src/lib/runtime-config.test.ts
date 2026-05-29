import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub next/cache.unstable_noStore — vitest runs outside Next's runtime
// so the real implementation throws ("called outside a Server
// Component"). The function is a no-op for our purposes (it tells Next
// not to cache; in a unit test there is no cache to opt out of).
vi.mock("next/cache", () => ({
    unstable_noStore: () => {},
}));

import { getRuntimeConfig } from "./runtime-config";

describe("server getRuntimeConfig (shell)", () => {
    const ORIGINAL_ENV = { ...process.env };

    beforeEach(() => {
        for (const k of ["BASE_URL", "POSTHOG_HOST", "NODE_ENV"]) {
            delete (process.env as Record<string, string | undefined>)[k];
        }
    });

    afterEach(() => {
        Object.assign(process.env, ORIGINAL_ENV);
    });

    it("returns env values when all are set (production)", () => {
        (process.env as Record<string, string>).NODE_ENV = "production";
        process.env.BASE_URL = "https://showcase.copilotkit.ai";
        process.env.POSTHOG_HOST = "https://eu.i.posthog.com";
        expect(getRuntimeConfig()).toEqual({
            baseUrl: "https://showcase.copilotkit.ai",
            posthogHost: "https://eu.i.posthog.com",
        });
    });

    it("strips trailing slashes", () => {
        (process.env as Record<string, string>).NODE_ENV = "production";
        process.env.BASE_URL = "https://showcase.example.com/";
        process.env.POSTHOG_HOST = "https://eu.i.posthog.com//";
        const cfg = getRuntimeConfig();
        expect(cfg.baseUrl).toBe("https://showcase.example.com");
        expect(cfg.posthogHost).toBe("https://eu.i.posthog.com");
    });

    it("falls back to dev defaults when unset in non-production", () => {
        (process.env as Record<string, string>).NODE_ENV = "development";
        const cfg = getRuntimeConfig();
        expect(cfg.baseUrl).toBe("http://localhost:3000");
        expect(cfg.posthogHost).toBe("https://eu.i.posthog.com");
    });

    it("falls back to sentinel and console.errors in production (BASE_URL only)", () => {
        (process.env as Record<string, string>).NODE_ENV = "production";
        const errs: string[] = [];
        const spy = vi
            .spyOn(console, "error")
            .mockImplementation((m: string) => {
                errs.push(m);
            });
        const cfg = getRuntimeConfig();
        spy.mockRestore();
        expect(cfg.baseUrl).toBe("about:blank#shell-base-url-missing");
        // POSTHOG_HOST falls back silently (analytics key — legitimately absent in some envs).
        expect(cfg.posthogHost).toBe("https://eu.i.posthog.com");
        expect(errs.some((m) => m.includes("BASE_URL"))).toBe(true);
        expect(errs.some((m) => m.includes("POSTHOG_HOST"))).toBe(false);
    });

    it("reads live process.env on each call (no module-load freeze)", () => {
        (process.env as Record<string, string>).NODE_ENV = "production";
        process.env.BASE_URL = "https://first.example.com";
        process.env.POSTHOG_HOST = "https://eu.i.posthog.com";
        expect(getRuntimeConfig().baseUrl).toBe("https://first.example.com");
        process.env.BASE_URL = "https://second.example.com";
        expect(getRuntimeConfig().baseUrl).toBe("https://second.example.com");
    });

    it("getRuntimeConfigEdge skips noStore() (Edge runtime path)", async () => {
        const cacheMod = await import("next/cache");
        const noStoreSpy = vi.spyOn(cacheMod, "unstable_noStore");
        (process.env as Record<string, string>).NODE_ENV = "production";
        process.env.BASE_URL = "https://edge.example.com";
        process.env.POSTHOG_HOST = "https://edge-posthog.example.com";

        const { getRuntimeConfigEdge } = await import("./runtime-config");
        const cfg = getRuntimeConfigEdge();
        expect(cfg.baseUrl).toBe("https://edge.example.com");
        expect(noStoreSpy).not.toHaveBeenCalled();

        // And confirm the default entrypoint DOES call noStore().
        noStoreSpy.mockClear();
        getRuntimeConfig();
        expect(noStoreSpy).toHaveBeenCalledTimes(1);
        noStoreSpy.mockRestore();
    });
});
