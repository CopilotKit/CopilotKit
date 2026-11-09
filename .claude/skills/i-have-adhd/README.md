# i-have-adhd

Shape output so a reader with ADHD can act on it: next action first, numbered steps, lists capped at 5, no preamble, a visible win at the end.

Vendored from [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd) (MIT). The `docs` skill loads it as a writing filter for documentation pages.

## What it does

- **Leads with the next action.** The first line is something the reader can do now, not context.
- **Numbers multi-step work.** One bounded action per step. No "and then" twice in one step.
- **Caps lists at 5.** Longer lists split into do-now vs later, or must vs nice to have.
- **Restates state every turn.** The reader does not hold "we are on step 3 of 5" between messages.
- **Gives specific time estimates.** "About 15 minutes", not "a bit of work".
- **Makes wins visible.** Show what now works, in concrete terms.
- **Drops preamble and closers.** No "Great question", no "Hope this helps".

`disable-model-invocation: true` so it does not take over every session. Invoke it with `/i-have-adhd`, or let `docs` load it when writing pages.

When `docs` loads this skill, the rules apply to the documentation pages only. The rest of the session stays in normal mode.

## Usage

```
/i-have-adhd
```

Then every reply in the session follows these rules until you say "stop adhd mode" or "normal mode".

## Output

The same answer you would have gotten, reshaped: first line is the action, steps are numbered, the turn ends when the answer is done.
