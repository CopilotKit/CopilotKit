import { describe, expect, it } from "vitest";
import {
  parseWizardUrlState,
  serializeWizardUrlState,
} from "@/lib/wizard-url-state";
import type {
  WizardUrlAllowlists,
  WizardUrlState,
} from "@/lib/wizard-url-state";

// Small literal allow-lists, deliberately not the real ones, so this
// suite doesn't churn when the actual option lists change.
const allowed: WizardUrlAllowlists = {
  projectAnswers: ["yes", "no"],
  frontends: ["react", "vue", "angular"],
  features: ["chat", "hitl", "generative-ui"],
  backends: ["langgraph", "crewai"],
};

describe("serializeWizardUrlState", () => {
  it("returns the empty string when nothing is selected", () => {
    const state: WizardUrlState = { features: [] };
    expect(serializeWizardUrlState(state)).toBe("");
  });

  it("omits absent/empty keys entirely rather than emitting them empty", () => {
    const result = serializeWizardUrlState({ frontend: "vue", features: [] });

    expect(result).toBe("frontend=vue");
    expect(result).not.toContain("features=");
    expect(result).not.toContain("undefined");
  });

  it("orders keys frontend, features, backend regardless of input order", () => {
    const result = serializeWizardUrlState({
      backend: "crewai",
      frontend: "react",
      features: ["chat", "hitl"],
    });

    expect(result).toBe("frontend=react&features=chat,hitl&backend=crewai");
  });
});

describe("round-trip", () => {
  it("parseWizardUrlState(serializeWizardUrlState(s), allowed) equals s", () => {
    const state: WizardUrlState = {
      project: "yes",
      frontend: "vue",
      features: ["chat", "hitl"],
      backend: "langgraph",
    };

    const serialized = serializeWizardUrlState(state);
    const parsed = parseWizardUrlState(serialized, allowed);

    expect(parsed).toEqual(state);
  });
});

describe("parseWizardUrlState", () => {
  it("tolerates a leading '?', no leading '?', and the empty string", () => {
    expect(parseWizardUrlState("?frontend=vue", allowed).frontend).toBe("vue");
    expect(parseWizardUrlState("frontend=vue", allowed).frontend).toBe("vue");
    expect(parseWizardUrlState("", allowed)).toEqual({
      project: undefined,
      frontend: undefined,
      features: [],
      backend: undefined,
    });
  });

  it("round-trips the project answer through the query string", () => {
    const result = parseWizardUrlState("project=yes", allowed);
    expect(result.project).toBe("yes");
  });

  it("degrades an unknown project value to undefined rather than throwing", () => {
    expect(() => parseWizardUrlState("project=maybe", allowed)).not.toThrow();
    expect(
      parseWizardUrlState("project=maybe", allowed).project,
    ).toBeUndefined();
  });

  it("drops an unknown frontend but keeps valid siblings", () => {
    const result = parseWizardUrlState(
      "frontend=svelte&features=chat&backend=langgraph",
      allowed,
    );

    expect(result.frontend).toBeUndefined();
    expect(result.features).toEqual(["chat"]);
    expect(result.backend).toBe("langgraph");
  });

  it("drops an unknown backend but keeps valid siblings", () => {
    const result = parseWizardUrlState(
      "frontend=vue&features=chat&backend=autogen",
      allowed,
    );

    expect(result.frontend).toBe("vue");
    expect(result.features).toEqual(["chat"]);
    expect(result.backend).toBeUndefined();
  });

  it("drops an unknown feature id but keeps the valid siblings", () => {
    const result = parseWizardUrlState(
      "features=chat,not-a-real-feature,hitl",
      allowed,
    );

    expect(result.features).toEqual(["chat", "hitl"]);
  });

  it("de-duplicates features and returns them in allow-list order even reversed", () => {
    const result = parseWizardUrlState(
      "features=hitl,chat,hitl,generative-ui,chat",
      allowed,
    );

    expect(result.features).toEqual(["chat", "hitl", "generative-ui"]);
  });

  it("rejects 'constructor' and '__proto__' for project, frontend, backend, and features", () => {
    const result = parseWizardUrlState(
      "project=constructor&frontend=constructor&backend=__proto__&features=constructor,__proto__",
      allowed,
    );

    expect(result.project).toBeUndefined();
    expect(result.frontend).toBeUndefined();
    expect(result.backend).toBeUndefined();
    expect(result.features).toEqual([]);
  });

  it("takes the first value of a repeated key", () => {
    const result = parseWizardUrlState("frontend=vue&frontend=react", allowed);

    expect(result.frontend).toBe("vue");
  });
});
