# 🍳 Shared State Recipe Creator

## What This Demo Shows

This demo showcases CopilotKit's **shared state** functionality - a powerful feature that enables bidirectional data flow between:
1. **Frontend → Agent**: UI controls update the agent's context in real-time
2. **Agent → Frontend**: The Copilot's recipe creations instantly update the UI components

It's like having a cooking buddy who not only listens to what you want but also updates your recipe card as you chat - no refresh needed! ✨

## How to Interact

Mix and match any of these parameters (or none at all - it's up to you!):
- **Skill Level**: Beginner to expert 👨‍🍳
- **Cooking Time**: Quick meals or slow cooking ⏱️
- **Special Preferences**: Dietary needs, flavor profiles, health goals 🥗
- **Ingredients**: Items you want to include 🧅🥩🍄
- **Instructions**: Any specific steps

Then chat with your Copilot chef with prompts like:
- "I'm a beginner cook. Can you make me a quick dinner?"
- "I need something spicy with chicken that takes under 30 minutes!"

## ✨ Shared State Magic in Action

**What's happening technically:**
- The UI and Copilot agent share the same state object (**Agent State = UI State**)
- Changes from either side automatically update the other
- Neither side needs to manually request updates from the other

**What you'll see in this demo:**
- Set cooking time to 20 minutes in the UI and watch the Copilot immediately respect your time constraint
- Add ingredients through the UI and see them appear in your recipe
- When the Copilot suggests new ingredients, watch them automatically appear in the UI ingredients list
- Change your skill level and see how the Copilot adapts its instructions in real-time

This synchronized state creates a seamless experience where the agent always has your current preferences, and any updates to the recipe are instantly reflected in both places.

This shared state pattern can be applied to any application where you want your UI and Copilot to work together in perfect harmony!
