# QA: Shared State (Reading) — Microsoft Agent Framework (.NET)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the shared-state-read demo page
- [ ] Verify the recipe card form loads (`data-testid="recipe-card"`)
- [ ] Verify the CopilotSidebar opens by default with title "AI Recipe Assistant"
- [ ] Send a message via the sidebar
- [ ] Verify the agent responds with an assistant message (`[data-role="assistant"]`)

### 2. Feature-Specific Checks

#### Initial Recipe State

- [ ] Verify the recipe title input shows "Make Your Recipe"
- [ ] Verify the cooking time dropdown defaults to "45 min"
- [ ] Verify the skill level dropdown defaults to "Intermediate"
- [ ] Verify the default ingredients are displayed in the ingredients container
      (`data-testid="ingredients-container"`):
  - [ ] Carrots (3 large, grated) with carrot emoji
  - [ ] All-Purpose Flour (2 cups) with wheat emoji
- [ ] Verify the default instruction is displayed in the instructions container
      (`data-testid="instructions-container"`): "Preheat oven to 350°F (175°C)"

#### Suggestions

- [ ] Verify "Create Italian recipe" suggestion is visible
- [ ] Verify "Make it healthier" suggestion is visible
- [ ] Verify "Suggest variations" suggestion is visible

#### Recipe Editing (Local State)

- [ ] Edit the recipe title and verify it updates
- [ ] Change the skill level dropdown (Beginner/Intermediate/Advanced) and verify it updates
- [ ] Change the cooking time dropdown (5/15/30/45/60+ min) and verify it updates
- [ ] Toggle a dietary preference checkbox (e.g. "Vegetarian") and verify it's checked
- [ ] Click "+ Add Ingredient" (`data-testid="add-ingredient-button"`) and verify a new
      empty ingredient card (`data-testid="ingredient-card"`) appears
- [ ] Edit an ingredient name and amount
- [ ] Remove an ingredient by clicking the "x" button
- [ ] Click "+ Add Step" and verify a new instruction row appears
- [ ] Edit an instruction and verify it saves
- [ ] Remove an instruction by clicking the "x" button

#### AI-Powered Recipe Updates (useAgent with shared state)

- [ ] Click "Create Italian recipe" suggestion
- [ ] Verify the agent updates the recipe title, ingredients, and instructions
- [ ] Verify the blue Ping indicator appears on changed sections (dietary, ingredients, or instructions)
- [ ] Verify the "Improve with AI" button (`data-testid="improve-button"`) changes to
      "Please Wait..." while loading and is disabled
- [ ] Click "Improve with AI" and verify the recipe is enhanced after processing

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
