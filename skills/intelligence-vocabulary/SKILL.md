---
name: intelligence-vocabulary
description: >
  Locks customer-facing CopilotKit Intelligence docs to one approved name per
  concept. Use when writing, editing, or reviewing Intelligence docs, nav
  labels, signup labels, or image alt text in showcase/shell-docs. Don't use
  for renaming code identifiers, route slugs, env vars, API fields, or
  component names, or for docs that do not mention Intelligence.
version: 1.0.0
---

# Intelligence Vocabulary

Customer-facing Intelligence docs use one name per concept. A second name for the same thing is a regression.

## When To Use

Load this skill before writing or editing prose a customer reads about CopilotKit Intelligence. That includes pages, snippets, nav titles, button labels, and image alt text under `showcase/shell-docs`.

Also load `skills/intelligence-docs/SKILL.md` when the change adds, renames, or removes an Intelligence page. That skill keeps the landing page in sync. This skill owns the words.

Do not load this skill to rename code. Identifiers, route slugs, env vars, API fields, and component names stay as they are, even when a Stop word appears inside them.

## Procedures

### Procedure 1: Apply the word list

1. Read `references/words.md` before writing or editing customer-facing Intelligence prose.
2. Use the **Use** column for headings, nav titles, button labels, alt text, and body prose.
3. Keep plan names as Developer, Team, Team Self-hosted, and Enterprise.
4. If a fact already has a home in `references/words.md`, link to that page. Do not explain the fact again under a second name.
5. Write Inspector click steps with the labels the shipped controls render: **Rich Threads** and **Automatic Learning**.

### Procedure 2: Check the change

1. Search the added or edited prose for every phrase in the **Stop** column of `references/words.md`.
2. Keep a hit that the exception list in `references/words.md` names.
3. Rewrite every other hit to the **Use** word for that concept.
4. Leave identifiers, slugs, env vars, API fields, and component names unchanged.

## Decision Tree

- Customer-facing Intelligence prose, labels, or alt text: Procedure 1, then Procedure 2
- Page added, renamed, or removed: this skill for the words, and `skills/intelligence-docs/SKILL.md` for the landing page
- The only edit is code, a slug, an env var, or an API field: stop. Do not rename it to match the word list
- The page does not mention Intelligence: stop

## Red Flags

| Signal                                                                  | What it means                  | Do instead                                         |
| ----------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------- |
| Two names for one concept on the same page                              | The word list was skipped      | Procedure 2                                        |
| "managed" or "hosted" as the name of the CopilotKit-operated deployment | The deployment name drifted    | Write cloud-hosted                                 |
| A Stop word removed by renaming a component, slug, or env var           | The skill was applied to code  | Restore the identifier. Change only customer prose |
| Clerk, or a rollout cutoff, added to a customer page                    | Internal implementation leaked | Delete that sentence. Say what the customer does   |

## Error Handling

- **A Stop phrase is inside an identifier:** leave the identifier. Change the surrounding prose only when that prose uses the Stop word as a customer-facing name.
- **A hit is on the exception list:** keep it. Do not "fix" managed Channel, customer-managed, a hosted zone, a ticket id, or a plan name.
- **The approved word and the visible product label disagree:** use the label the shipped control renders for a click step. Record the conflict. Do not invent a third name.
- **No home exists for a new fact:** stop and name the missing page. Do not park the fact under a nearby page with a new synonym.
