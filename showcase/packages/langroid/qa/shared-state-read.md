# QA: Shared State (Reading) — Langroid

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the shared-state-read demo page
- [ ] Verify the recipe card form loads (`data-testid="recipe-card"`)
- [ ] Verify the CopilotSidebar opens by default with title "AI Recipe Assistant"
- [ ] Verify the chat input is visible inside the sidebar
- [ ] Send a message via the sidebar (e.g. "Summarize the recipe")
- [ ] Verify the agent responds with an assistant role message (`[data-role="assistant"]`)

### 2. Feature-Specific Checks

#### Initial Recipe State

- [ ] Verify the recipe title input shows "Make Your Recipe"
- [ ] Verify the cooking time dropdown defaults to "45 min"
- [ ] Verify the skill level dropdown defaults to "Intermediate"
- [ ] Verify the default ingredients are displayed in the ingredients container (`data-testid="ingredients-container"`):
  - [ ] Carrots (3 large, grated) with carrot emoji (🥕) — `data-testid="ingredient-card"`
  - [ ] All-Purpose Flour (2 cups) with wheat emoji (🌾)
- [ ] Verify the default instruction is displayed in the instructions container (`data-testid="instructions-container"`): "Preheat oven to 350°F (175°C)"

#### Suggestions

- [ ] Verify "Create Italian recipe" suggestion is visible
- [ ] Verify "Make it healthier" suggestion is visible
- [ ] Verify "Suggest variations" suggestion is visible

#### Recipe Editing (Local State)

- [ ] Edit the recipe title and verify it updates
- [ ] Change the skill level dropdown (Beginner / Intermediate / Advanced) and verify it updates
- [ ] Change the cooking time dropdown (5 min / 15 min / 30 min / 45 min / 60+ min) and verify it updates
- [ ] Toggle a dietary preference checkbox (e.g. "Vegetarian") and verify it's checked
- [ ] Verify all dietary options are present: High Protein, Low Carb, Spicy, Budget-Friendly, One-Pot Meal, Vegetarian, Vegan
- [ ] Click "+ Add Ingredient" (`data-testid="add-ingredient-button"`) and verify a new empty ingredient-card row appears with the 🍴 icon
- [ ] Edit an ingredient name and amount in the new row
- [ ] Remove an ingredient by clicking its "x" button
- [ ] Click "+ Add Step" and verify a new empty instruction row appears
- [ ] Edit an instruction in the textarea and verify it saves
- [ ] Remove an instruction by clicking its "x" button

#### AI-Powered Recipe Updates (useAgent with shared state)

- [ ] Click "Create Italian recipe" suggestion
- [ ] Verify the agent updates the recipe title, ingredients, and instructions via shared state
- [ ] Verify the Ping indicator (blue circle) appears on changed sections (ingredients / instructions / dietary preferences)
- [ ] Verify the "Improve with AI" button (`data-testid="improve-button"`) changes to "Please Wait..." while loading
- [ ] Verify the button is disabled (`cursor-not-allowed`, gray background) while loading
- [ ] Click "Improve with AI" and verify the recipe is enhanced

#### Agent Reads Frontend State

- [ ] Edit the recipe (change title, add ingredients)
- [ ] Ask the agent "What recipe am I making?"
- [ ] Verify the agent's response references the current recipe state

### 3. Error Handling

- [ ] Send an empty message (should be handled gracefully)
- [ ] Verify no console errors during normal usage
- [ ] Verify the "Improve with AI" button is disabled while loading

## Expected Results

- Recipe card and sidebar load within 3 seconds
- Agent responds within 10 seconds
- Recipe state syncs bidirectionally between UI and agent
- Ping indicators highlight changed sections
- No UI errors or broken layouts

## Notes

- Stub-vs-test mismatch: the e2e spec `tests/e2e/shared-state-read.spec.ts` expects a "Sales Pipeline" dashboard and "Sales Pipeline Assistant" sidebar title, but the page implementation is a Recipe demo with "AI Recipe Assistant" sidebar title. Tests likely fail against this implementation.
