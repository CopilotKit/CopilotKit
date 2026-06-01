# QA: Shared State (Read + Write) — Built-in Agent (TanStack AI)

## Prerequisites

- Set `OPENAI_API_KEY` in `.env.local` (or environment).
- Run `npm install --legacy-peer-deps && npm run dev` from the `built-in-agent/` package directory.
- Demo URL: `http://localhost:3000/demos/shared-state-read-write`

## Page load

- [ ] Page heading "Shared State (Read + Write)" is visible in the left column.
- [ ] A text input pre-filled with "Tomato Pasta" is visible.
- [ ] "Ingredients" section lists "200g Pasta" and "3 medium Tomato".
- [ ] "Steps" section lists "Boil pasta", "Sauté tomato", "Combine".
- [ ] Chat input is visible in the right column.

## Happy path interaction

- [ ] Edit the title input from "Tomato Pasta" to "Spicy Arrabbiata". Verify the input updates immediately in the UI.
- [ ] Ask the agent: "Add a new ingredient: 2 cloves of garlic." Verify the ingredients list updates to include the new entry.
- [ ] Ask the agent: "What recipe am I making?" Verify the agent's response references the current recipe title (reflecting the edited title if applicable).

## Edge cases worth checking

- [ ] Clear the title input field completely. Verify the UI handles an empty title without crashing.
- [ ] Ask the agent to add multiple ingredients in one message. Verify all additions appear in the list after the agent responds.
