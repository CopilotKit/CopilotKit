import { describe, expect, it, vi } from "vitest";
import { DocsSetupWizard } from "../docs-setup-wizard";
vi.mock("../setup-wizard", () => ({ SetupWizard: () => null }));
vi.mock("@/lib/homepage-map", () => ({
  agentPicks: () => [{ id: "deepagents", name: "Deep Agents" }],
  frontendPicks: () => [],
  COPILOTKIT_CAPABILITIES: [],
}));
describe("docs-only partner setup", () => {
  it.each(["a2a", "agent-spec", "deepagents"])(
    "keeps %s selectable as the fixed backend",
    (backend) => {
      const element = DocsSetupWizard({ backend });
      expect(element.props.fixedBackend).toBe(backend);
      expect(
        element.props.backends.filter(
          (pick: { id: string }) => pick.id === backend,
        ),
      ).toHaveLength(1);
    },
  );
  it("does not add docs-only choices to the generic wizard", () => {
    expect(DocsSetupWizard().props.backends).toHaveLength(1);
  });
});
