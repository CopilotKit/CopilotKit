<!--
Thank you for sending the PR! We appreciate you spending the time to work on these changes.

Help us understand your motivation by explaining why you decided to make this change.

You can learn more about contributing to appwrite here: https://github.com/copilotkit/copilotkit/blob/master/CONTRIBUTING.md

Happy contributing!

-->

## What does this PR do?

(Brief description of your changes)

## Testing

- [ ] I tested my changes locally with linked CopilotKit packages
- [ ] I ran E2E tests: `cd e2e && pnpm start-apps` then `pnpm test`
- [ ] If I added a new app, it's in `e2e/example-apps/` and auto-discovered
- [ ] If I need a main example tested, I added it to the whitelist in the startup script

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation/tooling

## Environment

- [ ] No new API keys required
- [ ] Requires new API key: ****\_\_\_\_****

## Related Issues

- (Link to related issue/PR if any)

---

**For reviewers:** To test locally, run:

```bash
cd e2e
export OPENAI_API_KEY=sk-your-key
pnpm start-apps & sleep 30 && pnpm test
```
