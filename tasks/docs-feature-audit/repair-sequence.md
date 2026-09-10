# Proposed repair sequence

This is the next implementation plan, based on the audit. No product, example, or guide repair
has been applied. Use the [defect register](defect-register.md) and
[runtime classifications](runtime-failure-classification.json) as the work list; preserve the
failed baseline evidence when adding passing verification.

## 1. Make the five-agent baseline reproducible

- Fix the ADK route collision and LangGraph JS dev-bundler mismatch in Showcase.
- Supply the missing strict AIMock fixtures for the confirmed Built-in Agent gaps. Diagnose the
  remaining recorded timeouts before assigning them to product code or fixtures.
- Repair Built-in Agent configuration propagation and the Strands recipe/context bridge, with
  assertions that depend on the values actually reaching the agent. A fixture selected solely
  by the user's message is insufficient for these features.
- Verify the examples against exact latest stable public dependency versions. Keep those results
  separate from the checked-in dependency baseline. Any SDK/adapter fix needed by a public guide
  must ship in a stable release before that guide is qualified.

Completion evidence: every applicable selected React feature has a passing discriminating check,
or an explicit support limitation/blocker. Keep quarantined interrupt demos visible as untested;
do not include them in passing coverage.

## 2. Make generated content reflect the working example

- Repair missing source regions and catalog bindings at their Showcase sources.
- Give HTML and Markdown the same support decisions and selected-framework code. Unsupported
  pages must not quietly serve another framework's implementation.
- Resolve ADK's missing guide sources and supply only the framework-specific setup the examples
  actually require. Reuse existing shared/root content and sparse overrides.
- Replace external-only feature viewers with the appropriate Showcase examples and extracted
  implementation code. Respect the agreed Channels exception and upstream AG-UI ownership.

Completion evidence: regenerate and build docs, resolve redirects, check both representations,
and reject visible extraction errors for supported features. Extend the existing checks; do not
create a second source of truth.

## 3. Repair the implementation path and copy prompts

- Correct stale v1/v2 signatures, API links, agent identifiers, platform-specific flags, and
  unsafe identity instructions in their owning sources. Where several guides repeat the same
  error, repair the shared pattern and retain explicit framework differences.
- Reuse the existing Rich Threads and Learning setup-prompt helpers and CLI intents. Remove the
  duplicate hand-written Threads prompt contract.
- Bring Threads and Intelligence examples into Showcase so their guides have the same source and
  verification contract as other features. Channels still needs separate real-platform testing;
  an embedded example cannot prove Slack or Teams setup.
- Edit for a direct implementation path: outcome, necessary setup, extracted code, a test action,
  expected result, and relevant API references. Remove obsolete instructions and unnecessary
  dependencies rather than adding explanatory prose around them.

Completion evidence: follow each guide and its copy prompt locally, and verify the resulting
feature. Record when credentials or external platform access are required instead of substituting
an unrelated mocked success.

## 4. Expand frontend coverage deliberately

Start Angular, Vue, and React Native with LangGraph Python, then expand to the other public agents.
The current undeclared Vue/React Native matrix is missing coverage, not proof of parity. Define
equivalent supported outcomes and explicit differences before publishing a combination. React
Native qualification requires both iOS and Android execution.

Each feature should gain its runnable example, extracted guide inputs, support declaration, and
behavior check together. Fix the Angular registration/setup defects before using those guides as
templates for more integrations.

## 5. Keep the system accurate after this repair

Use the existing Showcase workflow to check affected examples and generated guides together.
Retain source revision, dependency versions, route-to-demo mapping, support state, and test
outcomes so a change cannot silently turn missing coverage into a pass. Add permanent checks only
where the audit demonstrates a failure mode: source-region drift, representation mismatch,
missing required setup, stale API examples, or nondiscriminating fixtures.

Documentation versioning and larger visual/navigation changes remain follow-ups. The immediate
deliverable is accurate, concise feature content and examples that prove it.
