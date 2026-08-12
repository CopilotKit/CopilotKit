# AEO Production Synthetics Runbook

The `AEO: Production Synthetics` workflow checks the production website and docs surfaces on demand. It remains manual until the production baseline is green and the Slack alert path has been deliberately exercised. The versioned public AEO contract is the source of truth for hosts, routes, and content types; the checker derives the in-scope discovery and LLM targets from it instead of copying hosts or routes into workflow YAML.

Failures are owned by `#oss-alerts`. The alert includes the failing URL, crawler identity, observed status and content type, a bounded response excerpt, and the Actions run. Failed-run output is retained as an artifact for 14 days.

These checks send documented crawler `User-Agent` values to exercise CDN, firewall, and application behavior. A spoofed header does not prove that a provider's verified crawler IP ranges or reverse-DNS identity can reach the service; investigate provider-identity access separately when the header-based check passes but real crawl telemetry regresses.

## Triage

1. Open the failed run and locate each `[FAIL]` record. Confirm whether the failure affects one crawler user agent or every agent.
2. Re-run the workflow once. Do not repeatedly retry: a second identical failure establishes the incident; a transient second pass still warrants checking the provider/CDN status.
3. Fetch the reported URL with the same `User-Agent`. Compare status, `Content-Type`, redirect target, canonical host, and the response excerpt with the contract target.
4. Check the owning deployment and its most recent release. Website failures belong to the website maintainers and docs failures to docs maintainers.
5. For sitemap or LLM index failures, inspect a sampled link and confirm that generated absolute URLs use the canonical host. For a 200 HTML not-found page, treat it as an outage of the machine endpoint, not a successful response.
6. If the public surface intentionally changed, update the versioned contract and tests in a reviewed pull request before accepting a new baseline. Breaking changes require a new capability version and migration guidance.

## Rollback and recovery

If the drift is accidental, roll back the owning deployment to the last known-good revision using that service's normal deployment procedure. Do not weaken the synthetic baseline to make an outage green. After rollback or forward-fix, run the workflow on demand and attach the passing run to the incident or Linear issue.

If the alert action fails or `SLACK_WEBHOOK_OSS_ALERTS` is missing, the synthetic job still fails and emits a GitHub warning. Restore the repository secret or Slack webhook integration, then run the workflow with `exercise_alert` enabled to verify the alert path deliberately. Add a schedule only after one normal run is green and the deliberate alert reaches `#oss-alerts`.
