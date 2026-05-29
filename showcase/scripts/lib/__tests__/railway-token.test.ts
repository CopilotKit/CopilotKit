import { describe, expect, it, vi } from "vitest";
import {
    resolveRailwayTokenFromConfig,
    type RailwayConfigShape,
} from "../railway-token";

describe("resolveRailwayTokenFromConfig", () => {
    it("prefers user.accessToken when present", () => {
        const cfg: RailwayConfigShape = {
            user: {
                accessToken: "new-access-token-43-chars-or-more-aaaaaaaa",
                token: "legacy-short-token",
            },
        };
        const warn = vi.fn();
        const result = resolveRailwayTokenFromConfig(cfg, { warn });
        expect(result).toBe("new-access-token-43-chars-or-more-aaaaaaaa");
        expect(warn).not.toHaveBeenCalled();
    });

    it("falls back to top-level accessToken", () => {
        const cfg: RailwayConfigShape = {
            accessToken: "top-level-access-token-aaaaaaaaaaaaaaaaaaaa",
        };
        const warn = vi.fn();
        const result = resolveRailwayTokenFromConfig(cfg, { warn });
        expect(result).toBe("top-level-access-token-aaaaaaaaaaaaaaaaaaaa");
        expect(warn).not.toHaveBeenCalled();
    });

    it("falls back to legacy user.token AND emits a deprecation warning", () => {
        const cfg: RailwayConfigShape = {
            user: { token: "legacy-short-token-aaaaaaaaaa" },
        };
        const warn = vi.fn();
        const result = resolveRailwayTokenFromConfig(cfg, { warn });
        expect(result).toBe("legacy-short-token-aaaaaaaaaa");
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toMatch(
            /deprecated.*user\.token.*accessToken/i,
        );
    });

    it("falls back to top-level token with deprecation warning", () => {
        const cfg: RailwayConfigShape = { token: "legacy-top-aaaaaaaaa" };
        const warn = vi.fn();
        const result = resolveRailwayTokenFromConfig(cfg, { warn });
        expect(result).toBe("legacy-top-aaaaaaaaa");
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it("returns undefined and does not warn on an empty config", () => {
        const warn = vi.fn();
        const result = resolveRailwayTokenFromConfig({}, { warn });
        expect(result).toBeUndefined();
        expect(warn).not.toHaveBeenCalled();
    });

    it("ignores empty-string tokens at every layer", () => {
        const cfg: RailwayConfigShape = {
            user: { accessToken: "", token: "" },
            accessToken: "",
            token: "",
        };
        const warn = vi.fn();
        const result = resolveRailwayTokenFromConfig(cfg, { warn });
        expect(result).toBeUndefined();
    });
});
