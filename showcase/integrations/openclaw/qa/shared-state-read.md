# QA: Shared State (Reading) (OpenClaw)

Demo source: `src/app/demos/shared-state-read/page.tsx`
Route: `/demos/shared-state-read` · Agent: `shared-state-read`
Run against the real backend at `http://localhost:3119/demos/shared-state-read`.

Status: **supported** (state/context category in `PARITY_NOTES.md`). This is the
**read-only** half: the UI publishes state, the agent reads it. The write-back
direction is a separate demo (`shared-state-read-write`).

## What it exercises

A recipe form whose single source of truth is `agent.state.recipe`. The page
uses `useAgent` (v2) with `OnStateChanged` / `OnRunStatusChanged`; every edit
flows straight into `agent.setState({ recipe })`, and the next render reflects
it. The recipe rides to the OpenClaw gateway as **agent state over AG-UI**, so
the model can read the current recipe on each turn and answer questions about it.

The wired gateway agent is the neutral default with **no tools** — this demo
tests the **read** direction only. The frontend declares no
`forwardedProps.stateWriterTools`, so the agent does not mutate the recipe; it
reads the published state and responds in chat. (Editing the recipe from the
sidebar — the write-back path — is `shared-state-read-write`.)

## Prerequisites

- Stack is up; demo reachable at the URL above.
- Gateway is healthy (per-demo agent names all map to the one OpenClaw endpoint).

## Manual steps

1. Open the demo. Confirm the recipe form renders
   (`data-testid="recipe-card"`) and the `CopilotSidebar` is open by default
   with title **"AI Recipe Assistant"**.
2. Confirm the seeded initial recipe:
   - Title **"Make Your Recipe"**, cooking time **45 min**, skill level
     **Intermediate**.
   - Ingredients: **Carrots** (3 large, grated, 🥕) and **All-Purpose Flour**
     (2 cups, 🌾).
   - One instruction: **"Preheat oven to 350°F (175°C)"**.
3. Edit the form directly (no agent involved): change the title, add an
   ingredient via **"+ Add Ingredient"** (`data-testid="add-ingredient-button"`),
   add a step via **"+ Add Step"**, toggle a dietary preference. Confirm each
   edit updates in place — this is local `agent.setState`, the source of truth.
4. Ask the agent to **read** the current state:
   **"What recipe am I making?"** Confirm the reply references your current
   title, ingredients, and steps — i.e. it reflects your edits, not the seed.
5. Ask a derived question: **"How many ingredients does it have?"** or
   **"Is this recipe vegetarian?"** Confirm the answer is consistent with the
   form's current state.
6. Edit the recipe again, then ask another read question. Confirm the agent's
   answer tracks the latest edits (state is re-published each turn).

## Assertion bar

- The agent's answers reflect the **current** form state, including edits made
  after the last message (state travels as `agent.state`, refreshed per turn).
- The form is the single source of truth: agent replies do **not** change the
  recipe card in this demo (that is `shared-state-read-write`).
- Exactly one run per request; the response is coherent and grounded in the
  actual recipe.

## Caveats

- Read-only by design. The **"Improve with AI"** button
  (`data-testid="improve-button"`) sends an "Improve the recipe" message and
  runs the agent, but with no state-writer tool wired the agent responds in
  chat rather than rewriting the card. Use `shared-state-read-write` to verify
  the mutating path.
- No per-demo backend graph — state reaches the model purely as AG-UI agent
  state through the pass-through gateway. If the agent seems unaware of an edit,
  confirm a run happened _after_ the edit (the snapshot is sent with the turn).
