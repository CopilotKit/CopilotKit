import { describe, expect, it } from "vitest";
import {
    parseArgs,
    resolveProbeTargets,
    type ProbeRunner,
    runVerify,
} from "../verify-deploy";

describe("verify-deploy argv parsing", () => {
    it("requires --env", () => {
        expect(() => parseArgs([])).toThrow(/--env/);
    });

    it("accepts --env staging and --env prod", () => {
        expect(parseArgs(["--env", "staging"]).env).toBe("staging");
        expect(parseArgs(["--env=prod"]).env).toBe("prod");
    });

    it("rejects unknown envs", () => {
        expect(() => parseArgs(["--env", "dev"])).toThrow(/Unknown env/);
    });

    it("accepts optional --services CSV", () => {
        const parsed = parseArgs(["--env", "staging", "--services", "docs,shell"]);
        expect(parsed.services).toEqual(["docs", "shell"]);
    });
});

describe("resolveProbeTargets", () => {
    it("filters SSOT to entries where probe[env] is true", () => {
        const targets = resolveProbeTargets({ env: "staging" });
        // docs is staging:true → must be present.
        expect(targets.find((t) => t.name === "docs")).toBeDefined();
    });

    it("REFUSES when a probe-required service has no domain for the env", () => {
        expect(() =>
            resolveProbeTargets({
                env: "staging",
                overrides: {
                    docs: { domains: { staging: "", prod: "docs.copilotkit.ai" } },
                },
            }),
        ).toThrow(/missing.*staging.*domain/i);
    });

    it("honors --services filter (subset of probe-eligible)", () => {
        const targets = resolveProbeTargets({
            env: "staging",
            services: ["docs"],
        });
        expect(targets.length).toBe(1);
        expect(targets[0].name).toBe("docs");
    });
});

describe("runVerify driver dispatch", () => {
    it("calls the driver for each target and fails loud on any red", async () => {
        const calls: string[] = [];
        const runner: ProbeRunner = async (target) => {
            calls.push(`${target.driver}:${target.host}`);
            if (target.name === "docs") {
                return { ok: false, error: "DOM string missing" };
            }
            return { ok: true };
        };
        const summary = await runVerify({
            env: "staging",
            services: ["docs", "shell"],
            runner,
        });
        expect(calls).toContain("docs:docs.staging.copilotkit.ai");
        expect(calls).toContain("shell:showcase.staging.copilotkit.ai");
        expect(summary.failed.map((f) => f.name)).toEqual(["docs"]);
        expect(summary.exitCode).toBe(1);
    });

    it("exits 0 when all probes green", async () => {
        const summary = await runVerify({
            env: "staging",
            services: ["docs"],
            runner: async () => ({ ok: true }),
        });
        expect(summary.exitCode).toBe(0);
    });
});
