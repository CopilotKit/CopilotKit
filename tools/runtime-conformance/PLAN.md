# Intelligence runtimes

## Required outcome

TypeScript, Python, Go, Ruby on Rails, and C# mount the Intelligence runtime API.
The existing TypeScript implementation is the fifth supported language, not only a reference.
Every language must pass the same shared tests.
Only IntelligenceRunner is in scope. Its implementation must be complete.
The four new libraries run natively without a Node sidecar or another runner.
The TypeScript runtime at commit `862ff3c180` is the initial compatibility baseline.

The release gate is a reviewed CopilotKit PR with passing checks and a public Sites walkthrough.
No package release, deployment of a runtime, or merge is authorized.
The public walkthrough is the explicit exception to the publishing restriction.
The walkthrough must use the simple-english skill for text and diagram captions.

## Work sequence

1. Extract the browser API and platform protocol into shared runnable cases.
2. Build native libraries and framework adapters against those cases.
3. Extend cases for MCP Apps, A2UI, telemetry, failures, and concurrency.
4. Review each library, build installable artifacts, and run integration checks.
5. Publish the walkthrough with generated diagrams and open the reviewed PR.

## Compatibility scope

| Surface     | Required behavior                                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| Discovery   | Agent descriptions, Intelligence mode, entitlements, thread capabilities, A2UI flags, telemetry opt-out                    |
| Runs        | Trusted identity, thread creation race, canonical lock IDs, gateway join before HTTP success, native or HTTP AG-UI agents  |
| Durability  | Acknowledged event delivery, stable event IDs and sequence, bounded retries, backpressure, lock renewal, cleanup, shutdown |
| Connections | JSON credentials, blank-thread 204, platform status fidelity, persisted history, reconnect without a new run               |
| Threads     | List, messages, events, state, update, archive, delete, subscription credentials                                           |
| Memories    | List, create, update, retire, recall, subscriptions, trusted grants and user identity                                      |
| Learning    | Annotation API and optional container selection at the run boundary                                                        |
| MCP Apps    | Tool discovery/execution, UI activity, proxied resource/tool requests, per-agent server configuration                      |
| A2UI        | Tool/schema context, streamed surface activity, render results, action history, per-agent configuration                    |
| Telemetry   | Full existing analytics: lifecycle events, sampling, identity, safe attributes, bounded export, shutdown, and opt-out      |
| Hosting     | ASGI Python, Go net/http, Rails/Rack, ASP.NET Core, configurable CORS and authentication callbacks                         |

Voice/transcription, managed Channels, GraphQL, single-route dispatch, provider-specific agent frameworks,
Open Generative UI, and automatic LLM thread naming are candidates for explicit exclusions.
The unfinished user bullet (`They do not need`) does not establish an exclusion.
No listed candidate removes MCP Apps, A2UI, telemetry, or Intelligence persistence from the required outcome.
The TypeScript baseline has no OpenTelemetry spans or metrics. These are not part of its analytics parity contract.
Native MCP HTTP headers, explicit session deletion, and pre-connection method validation are documented safety improvements.

## Factory rules

The harness observes public HTTP responses and platform effects through real local sockets.
Every language runs the same cases. A driver configures a library but cannot implement runtime behavior.
Case IDs remain stable so an agent can target one failure without changing the success criteria.
Each feature requires a failing case before implementation, then a passing case with recorded evidence.
Fault cases cover ownership, malformed input, failed dependencies, concurrent runs, dropped ACKs, and shutdown.
Library tests supplement the shared cases. Passing the harness alone does not prove release readiness.

## Current evidence

Pull request #6967 contains the five-language implementation and its shared tests.
The public walkthrough is https://intelligence-runtime-guide.mikeryandev.chatgpt.site/.
The PR records current test results and review limits. Live checks must pass on the final commit.

## Developer experience

Each public API must fit its language: naming, errors, configuration, hosting, and cancellation.
Existing agent implementations must remain compatible with additive metadata support.
Package READMEs lead with installation and a working application example.
They explain supported behavior and host responsibilities, not project status or missing features.
The PR retains explicit exclusions and unverified checks for reviewers.
