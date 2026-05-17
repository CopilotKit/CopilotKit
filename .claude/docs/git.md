# Git & PRs

## Worktree Workflow

Always use a git worktree for non-trivial work. This keeps the main working tree clean and lets you work in isolation.

1. **Start a worktree** at the beginning of a task. This creates a new branch and a separate working directory.
2. **Do all work** inside the worktree — commits, builds, tests.
3. **Push the worktree branch** to the remote with `-u` to set up tracking.
4. **Create a PR** targeting `main` using `gh pr create --base main`.
5. **Clean up** the worktree after the PR is merged.

## Commit Early and Often, in Logical Chunks

**Commit your work as you go, not in one big dump at the end.** Each commit is a logical, self-contained unit. This rule is non-negotiable — letting a worktree accumulate hundreds of untracked files is how work gets lost and PRs become impossible to review.

**Rules:**
- Commit after each meaningful unit of work — a self-contained feature, a refactor, a bugfix, a docs sweep. Roughly one commit per logical idea.
- Tests for the code introduced in a commit belong in **that same commit**, not a separate one.
- Group related changes — if you rename a symbol, update its callers in the same commit.
- Don't bundle unrelated changes. A bugfix and a doc rewrite are two commits.
- Push after every commit. Unpushed commits are invisible to collaborators and at risk of being lost.

**Commit message style:**
- Plain English. No conventional-commit prefixes (`feat:`, `fix:`, `chore:`) unless the repo already uses them.
- Lead with what changed and why. Skip mechanical descriptions.
- Good: `add bridge restart recovery via Slack message metadata`
- Good: `drop default tool-call status posts; opt-in via showToolStatus`
- Bad: `update files`, `WIP`, `more changes`

**Detect drift and correct it.** If you notice a worktree accumulating uncommitted work for more than a single logical step, stop and commit before moving on. If you find yourself with a backlog of untracked files at the end of a session, split them into logical chunks and commit each — don't combine them just because they happened together.

## Creating a PR

When the work is ready:

1. Stage and commit your changes in the worktree.
2. Push the branch: `git push -u origin <branch-name>`
3. Create the PR: `gh pr create --base main`
4. Use a clear title (under 70 chars) and a body summarizing what changed and why.

## Commit Conventions

- Write concise commit messages focused on the "why", not the "what".
- Stage specific files — avoid `git add -A` or `git add .` to prevent accidentally including unrelated changes.
- Never amend commits unless explicitly asked. Always create new commits.
- Never force-push unless explicitly asked.
