---
name: copilotkit-self-update
description: Use when the user wants to update, refresh, or reinstall the CopilotKit agent SKILLS (the SKILL.md files that teach this agent about CopilotKit). NOT for updating the CopilotKit codebase or project — this is specifically about refreshing the skills/knowledge this agent has loaded. Triggers on "update copilotkit skills", "update skills", "refresh skills", "skills are stale", "skills are outdated", "get latest skills", "my copilotkit knowledge is wrong", "copilotkit APIs changed", "skills seem old", "wrong API names", "reinstall skills", "skills not working right", "update your copilotkit knowledge".
user_invocable: true
argument_hint: ""
---

# Update CopilotKit Skills

Run this command to pull the latest CopilotKit skills from GitHub:

```bash
npx skills add copilotkit/skills --full-depth -y
```

This does a fresh clone every time — it always gets the latest version regardless of what's cached.

This works across all tools — Claude Code, Codex, Cursor, Gemini CLI, and others. It detects which tools are installed and updates skills for each.

After the command completes, **start a new session** in your tool to pick up the changes.

## When to Suggest This

- User says the skills have wrong API names or outdated information
- User reports that a CopilotKit API doesn't match what the skill says
- User explicitly asks to update or refresh skills
- A new CopilotKit version was released and skills may be stale
