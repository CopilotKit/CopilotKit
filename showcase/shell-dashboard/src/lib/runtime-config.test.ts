import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub next/cache.unstable_noStore — vitest runs outside Next's runtime
// so the real implementation throws ("called outside a Server
// Component"). The function is a no-op for our purposes (it tells Next
// not to cache; in a unit test there is no cache to opt out of).
vi.mock("next/cache", () => ({
    unstable_noStore: () => {},
}));

import { getRuntimeConfig } from "./runtime-config";

describe("server getRuntimeConfig (shell-dashboard)", () => {
    const ORIGINAL_ENV = { ...process.env };

    beforeEach(() => {
        // Reset to a known empty slate; explicit per-test sets follow.
        for (const k of [
            "POCKETBASE_URL",
            "SHELL_URL",
            "OPS_BASE_URL",
            "NEXT_PUBLIC_POCKETBASE_URL",
            "NEXT_PUBLIC_SHELL_URL",
            "NEXT_PUBLIC_OPS_BASE_URL",
            "NODE_ENV",
        ]) {
            delete (process.env as Record<string, string | undefined>)[k];
        }
    });

    afterEach(() => {
        Object.assign(process.env, ORIGINAL_ENV);
    });

    it("returns env values when all are set (production)", () => {
        (process.env as Record<string, string>).NODE_ENV = "production";
        process.env.POCKETBASE_URL = "https://pocketbase-staging-eec0.up.railway.app";
        process.env.SHELL_URL = "https://showcase.staging.copilotkit.ai";
        process.env.OPS_BASE_URL = "https://harness-staging-2ee4.up.railway.app";
        expect(getRuntimeConfig()).toEqual({
            pocketbaseUrl: "https://pocketbase-staging-eec0.up.railway.app",
            shellUrl: "https://showcase.staging.copilotkit.ai",
            opsBaseUrl: "https://harness-staging-2ee4.up.railway.app",
        });
    });

    it("strips trailing slashes", () => {
        (process.env as Record<string, string>).NODE_ENV = "production";
        process.env.POCKETBASE_URL = "https://pb.example.com/";
        process.env.SHELL_URL = "https://shell.example.com//";
        process.env.OPS_BASE_URL = "https://ops.example.com///";
        const cfg = getRuntimeConfig();
        expect(cfg.pocketbaseUrl).toBe("https://pb.example.com");
        expect(cfg.shellUrl).toBe("https://shell.example.com");
        expect(cfg.opsBaseUrl).toBe("https://ops.example.com");
    });

    it("falls back to dev defaults when unset in non-production", () => {
        (process.env as Record<string, string>).NODE_ENV = "development";
        const cfg = getRuntimeConfig();
        expect(cfg.pocketbaseUrl).toBe("http://127.0.0.1:8090");
        expect(cfg.shellUrl).toBe("http://localhost:3000");
        expect(cfg.opsBaseUrl).toBe("http://localhost:9020");
    });

    it("falls back to sentinels and console.errors in production", () => {
        (process.env as Record<string, string>).NODE_ENV = "production";
        const errs: string[] = [];
        const spy = vi
            .spyOn(console, "error")
            .mockImplementation((m: string) => {
                errs.push(m);
            });
        const cfg = getRuntimeConfig();
        spy.mockRestore();
        expect(cfg.pocketbaseUrl).toBe("http://pocketbase.invalid");
        expect(cfg.shellUrl).toBe("about:blank#shell-url-missing");
        expect(cfg.opsBaseUrl).toBe("http://ops.invalid");
        expect(errs.some((m) => m.includes("POCKETBASE_URL"))).toBe(true);
        expect(errs.some((m) => m.includes("SHELL_URL"))).toBe(true);
        expect(errs.some((m) => m.includes("OPS_BASE_URL"))).toBe(true);
    });

    it("reads live process.env on each call (no module-load freeze)", () => {
        (process.env as Record<string, string>).NODE_ENV = "production";
        process.env.POCKETBASE_URL = "https://first.example.com";
        process.env.SHELL_URL = "https://shell.example.com";
        process.env.OPS_BASE_URL = "https://ops.example.com";
        expect(getRuntimeConfig().pocketbaseUrl).toBe("https://first.example.com");
        process.env.POCKETBASE_URL = "https://second.example.com";
        expect(getRuntimeConfig().pocketbaseUrl).toBe("https://second.example.com");
    });

    it("accepts NEXT_PUBLIC_* fallbacks when bare names are unset", () => {
        // Deploy-config contract: shell-dashboard reads bare names first,
        // but tolerates NEXT_PUBLIC_-prefixed variants so a Railway
        // service that follows the shell-docs naming convention still
        // wires through. See the readUrl fallback chain in
        // runtime-config.ts.
        (process.env as Record<string, string>).NODE_ENV = "production";
        process.env.NEXT_PUBLIC_POCKETBASE_URL = "https://alt-pb.example.com";
        process.env.NEXT_PUBLIC_SHELL_URL = "https://alt-shell.example.com";
        process.env.NEXT_PUBLIC_OPS_BASE_URL = "https://alt-ops.example.com";
        const cfg = getRuntimeConfig();
        expect(cfg.pocketbaseUrl).toBe("https://alt-pb.example.com");
        expect(cfg.shellUrl).toBe("https://alt-shell.example.com");
        expect(cfg.opsBaseUrl).toBe("https://alt-ops.example.com");
    });

    it("bare names take precedence over NEXT_PUBLIC_ variants when both set", () => {
        (process.env as Record<string, string>).NODE_ENV = "production";
        process.env.POCKETBASE_URL = "https://primary-pb.example.com";
        process.env.SHELL_URL = "https://primary-shell.example.com";
        process.env.OPS_BASE_URL = "https://primary-ops.example.com";
        process.env.NEXT_PUBLIC_POCKETBASE_URL = "https://alt-pb.example.com";
        process.env.NEXT_PUBLIC_SHELL_URL = "https://alt-shell.example.com";
        process.env.NEXT_PUBLIC_OPS_BASE_URL = "https://alt-ops.example.com";
        const cfg = getRuntimeConfig();
        expect(cfg.pocketbaseUrl).toBe("https://primary-pb.example.com");
        expect(cfg.shellUrl).toBe("https://primary-shell.example.com");
        expect(cfg.opsBaseUrl).toBe("https://primary-ops.example.com");
    });

    it("getRuntimeConfigEdge skips noStore() (Edge runtime path)", async () => {
        // Confirm the Edge wrapper passes `{ noStore: false }`.
        // Reach into the mocked module to assert noStore was NOT called
        // on this path, while the default getRuntimeConfig() above DID
        // call it.
        const cacheMod = await import("next/cache");
        const noStoreSpy = vi.spyOn(cacheMod, "unstable_noStore");
        (process.env as Record<string, string>).NODE_ENV = "production";
        process.env.POCKETBASE_URL = "https://edge.example.com";
        process.env.SHELL_URL = "https://edge-shell.example.com";
        process.env.OPS_BASE_URL = "https://edge-ops.example.com";

        const { getRuntimeConfigEdge } = await import("./runtime-config");
        const cfg = getRuntimeConfigEdge();
        expect(cfg.pocketbaseUrl).toBe("https://edge.example.com");
        expect(noStoreSpy).not.toHaveBeenCalled();

        // And confirm the default entrypoint DOES call noStore().
        noStoreSpy.mockClear();
        getRuntimeConfig();
        expect(noStoreSpy).toHaveBeenCalledTimes(1);
        noStoreSpy.mockRestore();
    });
});
