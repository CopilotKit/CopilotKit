# Omnara capability and evidence inventory

Tracking: [PNI-772](https://linear.app/copilotkit/issue/PNI-772).
Manifest features identify implemented demo routes, not passing hosted probes.
`deployed: false` and `docs_mode: hidden` remain in effect.

| Area                | Adapter/starter evidence                                                                     | Shared Showcase status                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Chat                | Published adapter emits text/reasoning and message snapshots; starter previously tested live | Shared three-turn chat/recall probe passed with hosted strict fixtures (November 9)            |
| Frontend tools      | Adapter registers AG-UI tools and resumes their pending results                              | Shared three-gradient probe passed, including hosted frontend-tool continuation (November 9)   |
| Backend tools       | Adapter accepts `backendTools` with server handlers                                          | Shared weather/default catch-all probe passed with real backend-tool continuation (November 9) |
| Approvals/questions | Native `omnara:permission` / `omnara:question` interrupts; starter previously tested live    | Not declared as catalog HITL support; those cells use different tool/approval contracts        |
| Attachments         | Adapter maps images/documents to native files; starter previously tested text attachments    | Shared multimodal cell unverified and not registered                                           |
| State               | No state snapshot/delta support found in adapter 0.0.1                                       | Shared state read/write/streaming not registered                                               |
| Persistence         | Native history snapshots and prior starter continuation checks                               | Shared Intelligence, visitor visibility and restart policy require PNI-774                     |

No unverified cell is listed in `not_supported_features` merely to remove it
from parity counts. Other catalog features remain unregistered pending actual
capability work and shared-probe evidence.

## Dependencies

- [PNI-773](https://linear.app/copilotkit/issue/PNI-773): real hosted provider
  routing to the existing public aimock service and fixtures; protocol,
  per-request context, strict misses, isolation and tool continuation proof.
- [PNI-774](https://linear.app/copilotkit/issue/PNI-774): shared Intelligence,
  verified visitor/thread ownership, native session continuation and visibility.
- [PNI-775](https://linear.app/copilotkit/issue/PNI-775): deployment, public
  rendering, source/image identity, generated docs and full parity evidence.

The profile is not rewritten to point at localhost. This package does not
create an Intelligence instance, use a new Omnara mock, or bypass strict probes.

## Registration checkpoint — November 6, 2026

- All three pre-registration shared D6 invocations failed with `Unknown slug
"omnara"`. This is registration evidence, not a failed hosted model run.
- Registry, runtime-route and source-region bundling checks passed with Omnara
  included. The initial implementation used shared frontend modules and handlers;
  those were subsequently moved into this package to match the standalone fleet.
- Omnara unit tests, typecheck, lint and production build passed at this
  checkpoint. LangGraph TypeScript was used as a reference; this PR no longer
  changes its implementation or adds verification targets to it.
- Initial browser rendering of all three surfaces in both applications returned
  HTTP 200, with visible composers and no page errors. Screenshots were captured
  with placeholder Omnara configuration and no model requests; they establish
  initial rendering only. Inspector chrome differs with the pinned SDK versions.
- Post-registration shared D6 attempts recognize Omnara but stop during local
  infrastructure preparation: one Vue build attempt failed, and another reached
  Compose but lacked `showcase/.env`. Docker Desktop is installed; its CLI is
  outside this shell's normal PATH. Hosted credentials could not be obtained
  through the available 1Password session.

There were **no passing hosted D6 results** at the November 6 checkpoint. PNI-772's real
three-cell RED/GREEN acceptance was still open pending a configured local test
stack and PNI-773's hosted-fixture evidence. Those initial-render screenshots,
unit tests, and builds did not establish passing hosted coverage.

## Hosted fixture checkpoint — November 9, 2026

The unchanged shared D6 driver ran serially against the local Omnara app using
real hosted agents on the isolated `copilotkit-showcase-aimock-pni773` profile.
Its model is `copilotkit-aimock` / `aimock`; the provider sends fixed
`X-AIMock-Context: omnara` and `X-AIMock-Strict: true` headers.

All three cells first failed with hosted `503 no_fixture_match` responses.
After appending the 12 applicable reference fixtures under the `omnara` context,
the same probes passed: three chat/recall turns, the Sunset/Forest/Cosmic
frontend-tool round trips, and the weather backend tool/default renderer.
A separate unmatched prompt through a real hosted Omnara agent still returned
`503` at aimock and a native model error, confirming strict misses did not fall
through to a real upstream model.

The fixture source lives under `showcase/aimock/d6/omnara/`; no probe,
frontend, or tool handler was changed to obtain these results. Subsequent source
localization preserves the same demo behavior; the hosted results above describe
the implementation at the time of those runs.

Limits of this evidence:

- The app was local; the model execution and aimock endpoint were hosted.
  This does not establish a deployed public Showcase surface.
- The fixture append preserved the existing fixture bank and pinned image.
  These runtime additions disappear on restart; PNI-775 must rebuild/publish
  the wrapper image containing the checked-in fixture files before relying
  on durable coverage.
- The provider cannot forward per-run headers or native request/session IDs.
  Runs were serialized. The harness's slug-only journal fallback is not proof
  of concurrent isolation; PNI-773 must keep that limitation explicit.
- Public visitor ownership, shared Intelligence, and cold process continuation
  remain PNI-774 work. `deployed: false` and `docs_mode: hidden` remain in effect.
