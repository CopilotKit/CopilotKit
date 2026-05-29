import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRuntimeConfig } from "./runtime-config.client";

describe("client getRuntimeConfig (shell-dashboard)", () => {
    const originalWindow = globalThis.window;

    beforeEach(() => {
        // jsdom provides `window` by default in this vitest config.
        // Reset any prior injection.
        delete (globalThis.window as Window & { __SHOWCASE_CONFIG__?: unknown })
            .__SHOWCASE_CONFIG__;
    });

    afterEach(() => {
        (globalThis as { window?: Window }).window = originalWindow;
    });

    it("returns the injected config", () => {
        (window as Window & { __SHOWCASE_CONFIG__?: unknown }).__SHOWCASE_CONFIG__ =
            {
                pocketbaseUrl: "https://pb.example.com",
                shellUrl: "https://shell.example.com",
                opsBaseUrl: "https://ops.example.com",
            };
        expect(getRuntimeConfig()).toEqual({
            pocketbaseUrl: "https://pb.example.com",
            shellUrl: "https://shell.example.com",
            opsBaseUrl: "https://ops.example.com",
        });
    });

    it("throws when __SHOWCASE_CONFIG__ is missing (wiring bug)", () => {
        expect(() => getRuntimeConfig()).toThrow(
            /window\.__SHOWCASE_CONFIG__ is missing/,
        );
    });

    it("throws on the server (no window)", () => {
        // Simulate SSR by removing window.
        const w = globalThis.window;
        // @ts-expect-error — deliberately removing window for the test
        delete globalThis.window;
        try {
            expect(() => getRuntimeConfig()).toThrow(
                /called on the server/,
            );
        } finally {
            (globalThis as { window?: typeof w }).window = w;
        }
    });
});
