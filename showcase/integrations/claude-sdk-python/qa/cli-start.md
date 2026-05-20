# QA: CLI Start Command — Claude Agent SDK (Python)

## Prerequisites

- None (manifest-only demo — no hosted route)

## Test Steps

### 1. Manifest

- [ ] Verify the `cli-start` entry exists in `manifest.yaml` under `demos:`
- [ ] Verify the `command` field reads `npx copilotkit@latest init --framework claude-sdk-python`
- [ ] Verify `cli-start` is listed in the `features:` array

### 2. Expected Behavior

- [ ] Running the command in a fresh directory scaffolds the Claude Agent SDK (Python) starter

## Expected Results

- Manifest entry validates against the showcase schema
- Command matches the canonical framework slug
