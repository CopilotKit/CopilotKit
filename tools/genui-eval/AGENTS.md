# Improving the A2UI prompts with genui-eval

You can improve the generative UI prompts by running this loop. Read `README.md` first for the commands. Run them as `pnpm -s --filter genui-eval eval <command>`: the `-s` keeps pnpm's script line out of stdout, so `--json` output parses.

## The loop

1. Measure the current prompt: `run --preset <preset> --json`. Note the run id.
2. Read what fails: `failures <run> --json`, optionally with `--model`, `--tier` or `--case`.
3. Change the wording in a spec file (start from `prompt --export-spec > spec.json`), or edit `packages/shared/src/generative-ui/prompt-spec.ts` on a branch.
4. Measure again: `run --preset <preset> --spec <file> --json`, then `report <new> --base <old> --json`.
5. Repeat. Or let `optimize` do the search.

## Accept a change only if

- no model gets worse at validity, on the held-out totals;
- it is clearly better on the held-out totals: the intervals do not overlap;
- each rendered guide grows by at most 10% in tokens (`prompt` shows the size). Between near ties, keep the shorter prompt.

## You may change

- the instruction text of both transports: wording, order, structure, examples;
- the items of the conditional blocks, but never their `when` lists;
- the schema settings: `notation`, `propDescriptions`, `commonProps`;
- component and prop descriptions (`descriptions`, keys `"Name"` or `"Name.prop"`).

## You must not

- read `cases/heldout.jsonl`, or use held-out samples to decide what to change. `failures` and report details only show training cases on purpose; the held-out totals are the exam;
- change the A2UI protocol: operation names, fields, shapes, bindings, the fence or tool format;
- change what a component does, or describe it as doing something it does not do;
- edit the cases or the scoring to make a number go up;
- spend beyond the budget: use `--estimate` first, and `--budget`.

A change is finished when a plain `run` (no `--spec`) of the edited builders scores the same as the winning spec did.
