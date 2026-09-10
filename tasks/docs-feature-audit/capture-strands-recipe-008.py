import runpy
from types import SimpleNamespace

ROOT = "/Users/tylerslaton/.codex/worktrees/3715/CopilotKit"
runpy.run_path(f"{ROOT}/showcase/integrations/strands/tests/python/conftest.py")
from agents.agent import build_state_prompt

recipe_sentinel = "AUDIT_RECIPE_SENTINEL_7f3c9a"
preference_sentinel = "AUDIT_PREFERENCE_SENTINEL_7f3c9a"
recipe_input = SimpleNamespace(
    state={"recipe": {"title": recipe_sentinel, "ingredients": ["saffron"]}},
    context=[],
    messages=[],
)
preference_input = SimpleNamespace(
    state={"preferences": {"name": preference_sentinel}},
    context=[],
    messages=[],
)
recipe_prompt = build_state_prompt(recipe_input, "Summarize the active UI data.")
preference_prompt = build_state_prompt(
    preference_input, "Summarize the active UI data."
)
result = {
    "recipe_sentinel_present": recipe_sentinel in recipe_prompt,
    "preference_sentinel_present": preference_sentinel in preference_prompt,
    "recipe_prompt": recipe_prompt,
    "preference_prompt": preference_prompt,
}
print(result)
if result["recipe_sentinel_present"]:
    raise SystemExit("unexpected: recipe sentinel reached build_state_prompt")
if not result["preference_sentinel_present"]:
    raise SystemExit("unexpected: preferences control did not reach build_state_prompt")
