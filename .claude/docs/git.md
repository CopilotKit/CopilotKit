# Git & PRs

## Worktree Workflow

Always use a git worktree for non-trivial work. This keeps the main working tree clean and lets you work in isolation.

1. **Start a worktree** at the beginning of a task. This creates a new branch and a separate working directory.
2. **Do all work** inside the worktree — commits, builds, tests.
3. **Push the worktree branch** to the remote with `-u` to set up tracking.
4. **Create a PR** targeting `main` using `gh pr create --base main`.
5. **Clean up** the worktree after the PR is merged.

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
