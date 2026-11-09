# docs

Write documentation a real person wants to read: short, plain, and built around someone trying to do a real thing.

The skill treats "document feature X" as the wrong goal. The right goal is "help someone do Y with X". It plans the reader's story first, shows you the readers, asks for tone, then writes.

## What it does

- **Finds your docs.** Looks for a docs folder (`docs/`, `documentation/`, `content/docs/`, and so on). If it finds none, it asks you where docs should go instead of guessing.
- **Adapts to your site.** Reads a few existing pages, learns the structure and frontmatter, and reuses whatever components the site already has (steps, tabs, callouts, cards) for storytelling. It never invents a component your site does not have and is not tied to any framework.
- **Stops on personas.** After it names the readers, it shows you the list (who, the user story, the page) and waits. It does not bury this in a plan and keep going.
- **Stops on tone.** Before it writes pages, it tells you the tone it inferred from neighboring pages and asks you to confirm or change it. Matching neighbors is not a silent yes.
- **Writes with two other skills.** Final page text is filtered through `simple-english` (pragmatic STE sentences) and `i-have-adhd` (next action first, numbered steps, lists capped at 5). If either skill is missing, it stops instead of writing a weaker substitute.
- **Plans the story.** Lists who reads the page and what each one wants, writes a user story per reader, and turns those stories into a set of short linked pages instead of one giant page.
- **Bans the tells.** No em dashes or en dashes, no separator glyphs, no "not X: it's Y" phrasing, no "key insight" or "gap".
- **Links it up.** Places pages where the reader's path expects them, cross-links both ways, and keeps every page reachable from the nav.

Tiny copy edits (typo, broken link, code-fence language, factual fix) skip the two gates. New pages, new sections, and journey rewrites do not.

## Usage

```
/docs
/docs write docs for tool interrupts
/docs reorganize the auth section
```

Expect two stops before any page is written: the persona list, then the tone question. Answer those, then the pages land.

## Output

Documentation written into your project's docs folder (or the location you point it at), split across short linked pages when the topic has more than one journey.

## Companion skills

- `simple-english` (required at write time): sentence limits, one word one meaning, active voice.
- `i-have-adhd` (required at write time): next action first, numbered steps, list cap, visible win.
