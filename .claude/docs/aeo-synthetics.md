# AEO Production Synthetics Runbook

The `AEO: Production Synthetics` workflow checks the production website and docs surfaces on demand. It remains manual until the production baseline is green and the Slack alert path has been deliberately exercised. The checker owns the canonical hosts, routes, and content types for the in-scope discovery and LLM targets instead of copying them into workflow YAML.

Failures are owned by `#oss-alerts`. The alert includes the failing URL, crawler identity, observed status and content type, a bounded response excerpt, and the Actions run. Failed-run output is retained as an artifact for 14 days.

These checks send documented crawler `User-Agent` values to exercise CDN, firewall, and application behavior. A spoofed header does not prove that a provider's verified crawler IP ranges or reverse-DNS identity can reach the service; investigate provider-identity access separately when the header-based check passes but real crawl telemetry regresses.

## Supported surfaces and owners

This is a maintainer checklist, not a public API or a new discovery endpoint. Keep endpoint expectations in [the existing checker](../../showcase/scripts/check-aeo-synthetics.ts); do not introduce a second JSON registry.

| Deployment / owner                         | Supported surfaces                                                | Existing verification                                                                                                                                           |
| ------------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docs maintainers — `docs.copilotkit.ai`    | `/`, `/robots.txt`, `/sitemap.xml`, `/llms.txt`, `/llms-full.txt` | Production synthetics check status, media type, canonical URLs, and index links.                                                                                |
| Docs maintainers — same deployment         | Per-page `.md` and `.mdx` responses                               | Shell-docs route tests in the existing `shell-docs unit suite` CI job. Sample a real Markdown page after deployment.                                            |
| Website maintainers — `www.copilotkit.ai`  | `/`, `/robots.txt`, `/sitemap.xml`, `/llms.txt`                   | Production synthetics plus route tests in `CopilotKit/website`. Website `/llms-full.txt` is not published or advertised; do not require it unless that changes. |
| Docs MCP maintainers — `mcp.copilotkit.ai` | `/sse` transport                                                  | Service-owned verification; not covered by this HTTP discovery checker.                                                                                         |

For machine endpoints, a successful HTML fallback is a failure even if its header claims plain text. These checks measure reachability and response shape, not whether an answer engine recommends CopilotKit or Intelligence.

## When changing a discovery surface

1. Keep the existing URL and response format working, or update consumers and redirects deliberately. Robots/sitemaps/canonical metadata use web conventions; `llms.txt` is a community convention, not a crawler guarantee.
2. Update the owning route test and, if a monitored endpoint changes, the existing checker and its tests in the same change. Coordinate website changes in `CopilotKit/website`; this repository does not deploy them.
3. Reuse existing CI. For a focused local check, run `pnpm nx run @copilotkit/showcase-scripts:test -- __tests__/check-aeo-synthetics.test.ts __tests__/aeo-synthetics-wiring.test.ts --maxWorkers=1`.
4. After deployment, run `pnpm nx run @copilotkit/showcase-scripts:check-aeo-synthetics` or the manual Actions workflow. When Markdown rendering changes, also fetch a representative page's `.md` and `.mdx` output and check its status, media type, and readable content.

Do not add a schedule or claim monitoring is active until the green production baseline and deliberate Slack alert exercise described below are complete.

## Triage

1. Open the failed run and locate each `[FAIL]` record. Confirm whether the failure affects one crawler user agent or every agent.
2. Re-run the workflow once. Do not repeatedly retry: a second identical failure establishes the incident; a transient second pass still warrants checking the provider/CDN status.
3. Fetch the reported URL with the same `User-Agent`. Compare status, `Content-Type`, redirect target, canonical host, and the response excerpt with the configured target.
4. Check the owning deployment and its most recent release. Website failures belong to the website maintainers and docs failures to docs maintainers.
5. For sitemap or LLM index failures, inspect a sampled link and confirm that generated absolute URLs use the canonical host. For a 200 HTML not-found page, treat it as an outage of the machine endpoint, not a successful response.
6. If the public surface intentionally changed, update the synthetic configuration and tests in a reviewed pull request before accepting a new baseline.

## Rollback and recovery

If the drift is accidental, roll back the owning deployment to the last known-good revision using that service's normal deployment procedure. Do not weaken the synthetic baseline to make an outage green. After rollback or forward-fix, run the workflow on demand and attach the passing run to the incident or Linear issue.

If the alert action fails or `SLACK_WEBHOOK_OSS_ALERTS` is missing, the synthetic job still fails and emits a GitHub warning. Restore the repository secret or Slack webhook integration, then run the workflow with `exercise_alert` enabled to verify the alert path deliberately. Add a schedule only after one normal run is green and the deliberate alert reaches `#oss-alerts`.
