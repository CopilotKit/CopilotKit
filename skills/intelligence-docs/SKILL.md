---
name: intelligence-docs
description: >
  Keeps the CopilotKit Intelligence landing page in sync when a new Intelligence
  feature ships or when Intelligence docs are added, renamed, or removed. Use
  when adding Intelligence capabilities, writing or moving pages under
  docs/intelligence, editing IntelligenceFeatureCards, or changing
  snippets/shared/intelligence/overview.mdx. Don't use for OSS-only frontend
  docs, Inspector pane callouts, or marketing-site copy.
---

# Intelligence Landing Page

`/intelligence/overview` is the product landing for CopilotKit Intelligence.
New Intelligence features and new Intelligence docs pages must land on that
page in the same change. Do not ship a guide that the landing does not name.

## When To Use

Load this skill when:

- A new Intelligence feature ships (threads, analytics, learning, channels,
  hosting, inspection, or a later pillar)
- A page is added, renamed, or removed under
  `showcase/shell-docs/src/content/docs/intelligence/`
- The shared Intelligence overview snippet or feature cards change

Do not load it for OSS frontend guides that do not use Intelligence, or for
Inspector pane callouts (`inspector-docs`).

## Landing sources

Edit these in the same change as the feature or docs page:

| Surface                         | File                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| Hero and cards                  | `showcase/shell-docs/src/components/content/landing-pages/intelligence-overview.tsx`                |
| Table, body, quickstart link    | `showcase/shell-docs/src/content/snippets/shared/intelligence/overview.mdx`                         |
| Section nav                     | `showcase/shell-docs/src/content/docs/intelligence/meta.json`                                       |
| Root sidebar Intelligence group | `showcase/shell-docs/src/content/docs/meta.json`                                                    |
| Card and CTA tests              | `showcase/shell-docs/src/components/content/landing-pages/__tests__/intelligence-overview.test.tsx` |
| Snippet order tests             | `showcase/shell-docs/src/lib/__tests__/intelligence-landing.test.ts`                                |

The root overview page only wraps the snippet. Do not duplicate landing copy
in `docs/intelligence/overview.mdx`.

## Procedures

### Procedure 1: Add a feature or docs page

1. Add or update the guide page under `docs/intelligence/` (or the existing
   threads/channels path the feature already uses).
2. Put the page in `intelligence/meta.json` and in the Intelligence group in
   `docs/meta.json` when it belongs in the sidebar.
3. Add a row to **What the platform adds** in the shared snippet. The deeper
   dive must be a real URL.
4. If the feature is a user-facing pillar, add a card to `FEATURES` in
   `intelligence-overview.tsx` with a unique CTA label and the same URL.
5. If the feature is a named pillar in the hero, add it to the subtitle.
6. Extend the tests in the same commit. Pin the new CTA href as a literal.

### Procedure 2: Rename or move a page

1. Update every landing CTA that pointed at the old path: table row, card
   `href`, quickstart link, and "Which page should I read next?".
2. Update `meta.json` files.
3. Update the tests that pin those hrefs.

### Procedure 3: Remove a feature or page

1. Remove the table row, card, subtitle mention, and nav entry.
2. Remove the matching test assertions.
3. Do not leave a landing link to a deleted page.

## Decision Tree

- New Intelligence feature or new Intelligence docs page: Procedure 1
- Rename or move: Procedure 2
- Remove: Procedure 3
- Docs exist but landing does not name them: stop and run Procedure 1

## Red Flags

| Signal                                                   | What it means                   | Do instead                             |
| -------------------------------------------------------- | ------------------------------- | -------------------------------------- |
| Guide merged, landing unchanged                          | Readers cannot find the feature | Procedure 1 in the same PR             |
| Card href and table href differ                          | Two stories for one feature     | Use one URL                            |
| CTA points at the marketing site when a docs page exists | Landing skips the guide         | Point at the docs page                 |
| Hero subtitle lists a pillar with no card or table row   | Copy without a path             | Add both, or drop the subtitle mention |

## Error Handling

- **No docs page yet:** do not invent a guide. You can still add a table row
  that points at the current public product URL, and replace it when the
  guide ships.
- **Feature is Intelligence-only but lives outside `docs/intelligence/`:**
  still add the landing CTA. Use the real path (`/threads`, `/channels`, and
  similar).
