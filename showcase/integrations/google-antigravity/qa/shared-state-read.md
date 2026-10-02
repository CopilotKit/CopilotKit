# QA: Shared State (Reading) — Google Antigravity

## Prerequisites

- Demo is deployed and accessible at `/demos/shared-state-read` on the dashboard host
- Agent backend is healthy (`/api/health` or `/api/copilotkit` GET); `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) is set (the Go harness calls Gemini itself; `GOOGLE_GEMINI_BASE_URL` points it at aimock in tests)
- The agent server (`src/agent_server.py`) mounts `shared-state-read` at `/shared-state-read`, bound in `src/agents/registry.py` to `shared_state_read_agent()` from `src/agents/shared_state.py`; the page talks to it through `/api/copilotkit`
- How the agent sees the recipe: the page writes it with `agent.setState({ recipe })`. The agent's instructions tell the model to call the adapter's silent built-in `get_shared_state` tool (opted into with `experimental_app_state=True`) before every answer. That tool emits no TOOL_CALL events, so no tool card appears in the chat. The agent has no tool that writes the recipe: it can only suggest edits in chat, and the user applies them in the form.

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/shared-state-read`
- [ ] Verify the recipe form loads (`data-testid="recipe-card"`)
- [ ] Verify the CopilotSidebar opens by default with title "AI Recipe Assistant"
- [ ] Send a message via the sidebar
- [ ] Verify the agent responds

### 2. Feature-Specific Checks

#### Initial Recipe State

- [ ] Verify the recipe title input (aria-label "Recipe title") shows "Make Your Recipe"
- [ ] Verify the cooking time select (aria-label "Cooking time") shows "45 min"
- [ ] Verify the skill level select (aria-label "Skill level") shows "Intermediate"
- [ ] Verify no dietary preference badge is selected
- [ ] Verify the default ingredients (`data-testid="ingredient-card"` inside `data-testid="ingredients-container"`):
  - [ ] Carrots (3 large, grated) with the carrot emoji
  - [ ] All-Purpose Flour (2 cups) with the wheat emoji
- [ ] Verify the single default instruction in `data-testid="instructions-container"`: "Preheat oven to 350°F (175°C)"

#### Suggestions

- [ ] Verify "Create Italian recipe" suggestion is visible
- [ ] Verify "Make it healthier" suggestion is visible
- [ ] Verify "Suggest variations" suggestion is visible

#### Recipe Editing (UI writes shared state)

- [ ] Edit the recipe title and verify it updates
- [ ] Change the skill level and cooking time selects and verify they update
- [ ] Click a dietary preference badge (e.g. "Vegetarian") and verify it switches to the selected style (`aria-pressed="true"`); click again to deselect
- [ ] Click "+ Add Ingredient" (`data-testid="add-ingredient-button"`) and verify a new empty row appears with the fork-and-knife emoji
- [ ] Edit an ingredient name and amount
- [ ] Remove an ingredient with its "Remove ingredient" (X) button
- [ ] Click "+ Add Step" and verify a new numbered instruction row appears
- [ ] Edit an instruction, then remove it with its "Remove step" (X) button

#### Agent Reads the Current Recipe

- [ ] Change the title to "Lemon Pasta", add an ingredient "Lemons" (2), and set skill level to "Beginner"
- [ ] Ask the agent "What recipe am I making?"
- [ ] Verify the reply names "Lemon Pasta" and reflects the current ingredients (it read the edited state, not the initial recipe)
- [ ] Verify no tool-call card appears in the sidebar for the state read
- [ ] Toggle "Vegan" on and ask "Is this recipe OK for my diet?"; verify the reply takes the vegan preference into account

#### Suggestion Prompts and "Improve with AI"

- [ ] Click "Make it healthier"; verify the reply suggests changes based on the current ingredients
- [ ] Verify the form itself does NOT change — the agent only suggests edits; the recipe is written only by the UI
- [ ] Click "Improve with AI" (`data-testid="improve-button"`); verify the button shows a spinner and "Please Wait..." and is disabled while the run is in progress
- [ ] Verify a user message "Improve the recipe" appears in the sidebar, followed by a reply with improvement suggestions for the current recipe
- [ ] Verify the button returns to "Improve with AI" when the run finishes

### 3. Error Handling

- [ ] Send an empty message (should be handled gracefully)
- [ ] Verify no console errors during normal usage
- [ ] Verify clicking "Improve with AI" while a run is in progress does nothing (the button is disabled)

## Expected Results

- Recipe form and sidebar load within 3 seconds
- Agent responds within 10 seconds
- Every form edit lands in agent state, and the next reply reflects the current recipe
- The state read is silent (no tool card), and the agent never rewrites the form
- No UI errors or broken layouts
