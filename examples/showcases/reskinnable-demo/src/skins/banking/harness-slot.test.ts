import { afterEach, describe, expect, it, vi } from "vitest";
import { HARNESS_AGENT_ID } from "@/skins/banking/harness/types";

/**
 * `agent-registry.ts` has NO other drift guard: nothing else imports it from a
 * test (`grep -rln agentRegistry src --include='*.test.*'` found only this
 * file), and its `Record<string, AgentRegistration>` type accepts a missing key.
 * A typo'd or absent slot therefore renders a perfectly working page and fails
 * only when someone sends a message — on stage.
 *
 * The registry is built at MODULE SCOPE and reads `EXPENSE_HARNESS_MODE` there,
 * so every case below has to reset the module graph and re-import it rather than
 * flipping the env against an already-evaluated object.
 */

const set = (value: string | undefined) => {
  if (value === undefined) delete process.env.EXPENSE_HARNESS_MODE;
  else process.env.EXPENSE_HARNESS_MODE = value;
};

const original = process.env.EXPENSE_HARNESS_MODE;
afterEach(() => {
  set(original);
  vi.resetModules();
});

const loadRegistry = async (mode: string | undefined) => {
  set(mode);
  vi.resetModules();
  const { agentRegistry } = await import("@/shell/agent-registry");
  return agentRegistry;
};

describe("arm C's agent slot", () => {
  it("is registered under the id the client points at, in factory mode", async () => {
    const registry = await loadRegistry("factory");
    expect(registry[HARNESS_AGENT_ID]).toBeDefined();
    expect(typeof registry[HARNESS_AGENT_ID].createAgent).toBe("function");
  });

  it("is registered in both mode too", async () => {
    const registry = await loadRegistry("both");
    expect(registry[HARNESS_AGENT_ID]).toBeDefined();
  });

  it("is absent when the arm is off", async () => {
    // The flag's documented meaning. If this ever passes with the slot present,
    // `off` and `factory` have become indistinguishable and armCEnabled() is
    // dead code.
    const registry = await loadRegistry(undefined);
    expect(registry[HARNESS_AGENT_ID]).toBeUndefined();
  });

  it("is absent in tool mode, which is ARM A only", async () => {
    const registry = await loadRegistry("tool");
    expect(registry[HARNESS_AGENT_ID]).toBeUndefined();
  });

  it("never displaces the banking skin's own slot", async () => {
    // The two must coexist: Arm C is a SECOND agent, and banking's classic agent
    // (with its ~20 tools and every existing beat) has to keep working beside it.
    expect(HARNESS_AGENT_ID).not.toBe("banking");
    for (const mode of ["both", undefined]) {
      const registry = await loadRegistry(mode);
      expect(registry.banking).toBeDefined();
    }
  });
});
