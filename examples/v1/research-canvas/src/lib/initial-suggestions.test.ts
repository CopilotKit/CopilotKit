import { CopilotKitCore, HttpAgent } from "@copilotkit/react-core/v2";
import { expect, onTestFinished, test, vi } from "vitest";
import { initialSuggestions } from "./initial-suggestions";

test("shows initial suggestions without running the graph provider", async () => {
  const core = new CopilotKitCore({});
  const runAgent = vi
    .spyOn(HttpAgent.prototype, "runAgent")
    .mockRejectedValue(new Error("Suggestion provider must not run"));
  onTestFinished(() => runAgent.mockRestore());
  core.addAgent__unsafe_dev_only({
    id: "research_agent",
    agent: new HttpAgent({ url: "http://localhost/unused" }),
  });
  core.addSuggestionsConfig(initialSuggestions);

  core.reloadSuggestions("research_agent");

  await vi.waitFor(() => {
    expect(core.getSuggestions("research_agent").suggestions).toEqual([
      expect.objectContaining({
        title: "Lifespan of penguins",
        message: "Research the lifespan of penguins.",
      }),
    ]);
  });
  expect(runAgent).not.toHaveBeenCalled();
});
