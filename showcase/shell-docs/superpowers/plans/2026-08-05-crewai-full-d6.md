# CrewAI Full D6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use `ag-ui-crewai==0.0.0.dev1785927675` to make the CrewAI showcase execute and pass all 41 D6 feature probes, operate every demo with LangGraph-Python parity, and connect authored documentation that accurately records that parity.

**Architecture:** Keep the shared frontend/probe contract unchanged and replace CrewAI showcase workarounds with the alpha bridge's native Flow, reasoning, context, MCP, multimodal, A2UI, checkpoint, and HITL surfaces. CrewAI-specific behavior remains in thin Flow/Crew adapters and deterministic CrewAI aimock fixtures; LangGraph Python is the behavioral north star.

**Tech Stack:** Next.js 15, CopilotKit v2, AG-UI, FastAPI, CrewAI 1.15.8, LiteLLM 1.79.3, pytest, Playwright, aimock, Nx/pnpm, authored shell-docs MDX.

---

## File Map

- `examples/integrations/crewai-crews/agent/requirements.txt` and
  `examples/integrations/crewai-crews/docker/requirements-override.txt`:
  Dojo dependency source of truth for the alpha validation stack.
- `showcase/integrations/crewai-crews/requirements.txt`: showcase mirror of
  the exact working Dojo pins.
- `showcase/integrations/crewai-crews/src/agent_server.py`: FastAPI route
  composition only; obsolete request/response protocol shims leave this file.
- `showcase/integrations/crewai-crews/src/agents/reasoning_flow.py`: minimal
  native reasoning flow shared by the reasoning and reasoning/tool-chain cells.
- `showcase/integrations/crewai-crews/src/agents/interrupt_flow.py`: native
  async Flow HITL and checkpoint/resume behavior for both interrupt surfaces.
- `showcase/integrations/crewai-crews/src/agents/shared_state_read.py` and
  `shared_state_streaming.py`: dedicated state read and progressive-state flows.
- `showcase/integrations/crewai-crews/src/agents/multimodal_agent.py`: dedicated
  attachment-aware Flow endpoint.
- `showcase/integrations/crewai-crews/src/agents/a2ui_recovery.py`: backend-owned
  A2UI validate/retry/exhaust flow.
- `showcase/integrations/crewai-crews/src/agents/mcp_apps_agent.py`: native MCP
  wiring only; no bridge emulation.
- `showcase/integrations/crewai-crews/src/app/api/copilotkit/route.ts`: maps
  agent IDs to dedicated native backend paths.
- `showcase/integrations/crewai-crews/src/app/demos/a2ui-recovery/*` and
  `src/app/api/copilotkit-a2ui-recovery/route.ts`: LangGraph-parity frontend and
  runtime wiring for the only missing demo directory.
- `showcase/integrations/crewai-crews/tests/python/*`: integration-owned
  contract and Flow tests, written before implementation.
- `showcase/aimock/d6/crewai-crews/*.json`: only sanctioned integration-specific
  D6 variation.
- `showcase/integrations/crewai-crews/manifest.yaml`: full 41-type enrollment,
  no unsupported declarations.
- `showcase/integrations/crewai-crews/docs-links.json`: explicit connected-doc
  routing where global fallbacks are absent or point at the wrong product.
- `showcase/shell-docs/src/content/docs/integrations/crewai-flows/*`: authored
  capability documentation and navigation.

### Task 1: Establish the red baseline and pin the verified alpha stack

**Files:**

- Modify: `examples/integrations/crewai-crews/agent/requirements.txt`
- Modify: `examples/integrations/crewai-crews/docker/requirements-override.txt`
- Modify: `showcase/integrations/crewai-crews/requirements.txt`
- Create: `showcase/integrations/crewai-crews/tests/python/test_alpha_bridge_contract.py`

- [ ] **Step 1: Capture current red/skip behavior on three load-bearing cells**

Run the production-equivalent control-plane path against the current branch:

```bash
showcase/bin/showcase test crewai-crews:reasoning-custom --d6 --isolate
showcase/bin/showcase test crewai-crews:gen-ui-interrupt --d6 --isolate
showcase/bin/showcase test crewai-crews:multimodal --d6 --isolate
```

Expected: each cell is absent from enrollment or reported
`skipped-incapable`; none counts as an executed green D6 pass.

- [ ] **Step 2: Write the failing alpha bridge contract test**

```python
from importlib.metadata import version
from inspect import signature

from ag_ui_crewai import (
    add_crewai_flow_fastapi_endpoint,
    crewai_prepare_inputs,
    get_capabilities,
)


def test_alpha_stack_and_native_surface():
    assert version("ag-ui-crewai") == "0.0.0.dev1785927675"
    assert version("ag-ui-protocol") == "0.0.0.dev1785927675"
    assert version("crewai") == "1.15.8"
    assert version("litellm") == "1.79.3"
    assert "emit_interrupt_outcome" in signature(
        add_crewai_flow_fastapi_endpoint
    ).parameters
    assert "forwarded_props" in signature(crewai_prepare_inputs).parameters
    capabilities = get_capabilities()
    assert capabilities["transport"]["streamFrames"] is True
    assert capabilities["wireShape"]["emissionShape"] == "triples"
    assert capabilities["reasoning"]["supported"] is True
```

- [ ] **Step 3: Run the contract test and verify RED**

Run:

```bash
PYTHONPATH=showcase/integrations/crewai-crews:showcase/integrations/crewai-crews/src \
  python -m pytest \
  showcase/integrations/crewai-crews/tests/python/test_alpha_bridge_contract.py -v
```

Expected: FAIL because the installed requirements still resolve
`ag-ui-crewai==0.2.0` and CrewAI `0.130.0`.

- [ ] **Step 4: Apply the exact verified dependency set**

Put these lines in all three requirements surfaces, preserving any
surface-specific utility dependency below them:

```text
--find-links https://test.pypi.org/simple/ag-ui-crewai/
--find-links https://test.pypi.org/simple/ag-ui-protocol/
crewai==1.15.8
crewai-tools==1.15.8
ag-ui-crewai==0.0.0.dev1785927675
ag-ui-protocol==0.0.0.dev1785927675
ag-ui-a2ui-toolkit==0.0.4
litellm==1.79.3
python-dotenv==1.2.2
uvicorn==0.34.3
```

The package-scoped `--find-links` entries make only the two alpha packages
discoverable from TestPyPI; all transitive packages continue to resolve from
public PyPI.

- [ ] **Step 5: Rebuild and verify GREEN**

Run:

```bash
showcase/bin/showcase rebuild crewai-crews
PYTHONPATH=showcase/integrations/crewai-crews:showcase/integrations/crewai-crews/src \
  python -m pytest \
  showcase/integrations/crewai-crews/tests/python/test_alpha_bridge_contract.py -v
pnpm exec tsx showcase/scripts/validate-pins.ts
```

Expected: image build succeeds, the contract test passes, and pin validation
reports no CrewAI/Dojo drift.

- [ ] **Step 6: Commit and push**

```bash
git add examples/integrations/crewai-crews/agent/requirements.txt \
  examples/integrations/crewai-crews/docker/requirements-override.txt \
  showcase/integrations/crewai-crews/requirements.txt \
  showcase/integrations/crewai-crews/tests/python/test_alpha_bridge_contract.py
git commit -m "test(showcase): validate CrewAI alpha bridge stack"
git push
```

### Task 2: Replace obsolete bridge workarounds with native reasoning and input preparation

**Files:**

- Modify: `showcase/integrations/crewai-crews/tests/python/test_forwarded_props.py`
- Replace: `showcase/integrations/crewai-crews/tests/python/test_reasoning_parity.py`
- Delete: `showcase/integrations/crewai-crews/tests/python/test_reasoning_error_path.py`
- Delete: `showcase/integrations/crewai-crews/tests/python/test_reasoning_history.py`
- Create: `showcase/integrations/crewai-crews/src/agents/reasoning_flow.py`
- Delete: `showcase/integrations/crewai-crews/src/agents/reasoning_agent.py`
- Modify: `showcase/integrations/crewai-crews/src/agent_server.py`
- Modify: `showcase/integrations/crewai-crews/src/app/api/copilotkit/route.ts`

- [ ] **Step 1: Write failing native-route tests**

Add assertions that import the real `agent_server` and verify:

```python
def test_server_uses_native_reasoning_and_input_preparation(agent_server_source):
    assert "ForwardedPropsASGIMiddleware" not in agent_server_source
    assert "reasoning_app" not in agent_server_source
    assert "reasoning_flow" in agent_server_source
    assert '"/reasoning"' in agent_server_source
```

Add a real `crewai_prepare_inputs` test:

```python
def test_forwarded_props_and_context_reach_flow_state():
    state = crewai_prepare_inputs(
        state={},
        messages=[],
        tools=[],
        context=[Context(description="Account tier", value="enterprise")],
        forwarded_props={"tone": "concise"},
    )
    assert state["context"][0]["value"] == "enterprise"
    assert state["tone"] == "concise"
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
PYTHONPATH=showcase/integrations/crewai-crews:showcase/integrations/crewai-crews/src \
  python -m pytest \
  showcase/integrations/crewai-crews/tests/python/test_forwarded_props.py \
  showcase/integrations/crewai-crews/tests/python/test_reasoning_parity.py -v
```

Expected: FAIL because the raw ASGI middleware and custom reasoning sub-app
still own those behaviors.

- [ ] **Step 3: Implement the minimal native reasoning Flow**

Create a `Flow[CopilotKitState]` whose `@start()` method calls
`litellm.acompletion(..., stream=True)` and passes the stream through
`copilotkit_stream`. Preserve message history and expose the same system prompt
for both reasoning renderers and the reasoning/tool-chain route. Do not emit
`REASONING_*` manually; the alpha bridge owns translation and lifecycle close.

Register it with:

```python
add_crewai_flow_fastapi_endpoint(app, reasoning_flow, "/reasoning")
```

- [ ] **Step 4: Delete native-obsolete code**

Remove `ForwardedPropsASGIMiddleware`, `_splice_forwarded_props`, style-rule
duplication, the custom reasoning ASGI endpoint, and their synthetic-event
tests. Keep header forwarding and CVDIAG middleware because those solve
showcase observability, not bridge protocol behavior.

- [ ] **Step 5: Route both reasoning UIs through the native endpoint**

```typescript
agents["reasoning-custom"] = createAgent("/reasoning");
agents["reasoning-default"] = createAgent("/reasoning");
agents["tool-rendering-reasoning-chain"] = createAgent("/reasoning");
```

- [ ] **Step 6: Verify focused tests and direct probes GREEN**

```bash
PYTHONPATH=showcase/integrations/crewai-crews:showcase/integrations/crewai-crews/src \
  python -m pytest \
  showcase/integrations/crewai-crews/tests/python/test_forwarded_props.py \
  showcase/integrations/crewai-crews/tests/python/test_reasoning_parity.py -v
showcase/bin/showcase test crewai-crews:reasoning-custom --d6 --isolate
showcase/bin/showcase test crewai-crews:tool-rendering-reasoning-chain --d6 --isolate
```

Expected: real `REASONING_*` events render in both slots and reasoning/tool
lifecycle ordering closes cleanly.

- [ ] **Step 7: Commit and push**

```bash
git add showcase/integrations/crewai-crews/src \
  showcase/integrations/crewai-crews/tests/python
git commit -m "feat(showcase): use native CrewAI reasoning and inputs"
git push
```

### Task 3: Implement true Flow interrupts for both HITL surfaces

**Files:**

- Create: `showcase/integrations/crewai-crews/tests/python/test_interrupt_flow.py`
- Create: `showcase/integrations/crewai-crews/src/agents/interrupt_flow.py`
- Delete: `showcase/integrations/crewai-crews/src/agents/interrupt_crew.py`
- Modify: `showcase/integrations/crewai-crews/src/agent_server.py`
- Modify: `showcase/integrations/crewai-crews/src/app/api/copilotkit/route.ts`
- Modify: `showcase/aimock/d6/crewai-crews/gen-ui-interrupt.json`
- Modify: `showcase/aimock/d6/crewai-crews/interrupt-headless.json`

- [ ] **Step 1: Write failing Flow HITL tests**

Test the state machine through its public methods:

```python
async def test_interrupt_flow_calls_llm_before_and_after_feedback(flow, llm_spy):
    await flow.plan_meeting()
    assert llm_spy.call_count == 1
    assert flow.pending_feedback is not None
    flow.apply_feedback({"time": "2026-08-06T14:00:00Z"})
    await flow.confirm_meeting()
    assert llm_spy.call_count == 2
    assert flow.state["meeting"]["time"] == "2026-08-06T14:00:00Z"
```

Add a source/registration assertion:

```python
assert "emit_interrupt_outcome=True" in agent_server_source
```

- [ ] **Step 2: Run tests and verify RED**

```bash
PYTHONPATH=showcase/integrations/crewai-crews:showcase/integrations/crewai-crews/src \
  python -m pytest \
  showcase/integrations/crewai-crews/tests/python/test_interrupt_flow.py -v
```

Expected: FAIL because the current `InterruptScheduling` Crew is only a
frontend-tool adaptation and has no pause/resume checkpoint.

- [ ] **Step 3: Implement native async Flow feedback**

Use CrewAI's Flow feedback primitive with a structured payload matching the
LangGraph time-picker contract. The start stage streams an LLM plan, pauses for
feedback, and the resume stage streams the final confirmation. State includes
messages, pending meeting data, and the selected/cancelled outcome.

Register one shared backend for both UI surfaces:

```python
add_crewai_flow_fastapi_endpoint(
    app,
    interrupt_flow,
    "/interrupt",
    emit_interrupt_outcome=True,
    enable_legacy_on_interrupt_event=False,
)
```

- [ ] **Step 4: Route both agent IDs to `/interrupt`**

```typescript
agents["gen-ui-interrupt"] = createAgent("/interrupt");
agents["interrupt-headless"] = createAgent("/interrupt");
```

- [ ] **Step 5: Update deterministic two-turn fixtures**

Each fixture must provide a unique pre-pause planning response and a
post-feedback confirmation response matched by stable user/tool-result content,
not a backend-generated tool-call ID.

- [ ] **Step 6: Verify both shared interrupt probes GREEN**

```bash
showcase/bin/showcase fixtures validate
showcase/bin/showcase test crewai-crews:gen-ui-interrupt --d6 --isolate
showcase/bin/showcase test crewai-crews:interrupt-headless --d6 --isolate
```

Expected: inline and headless pickers both pause, resume, and finish with a
structured interrupt outcome.

- [ ] **Step 7: Commit and push**

```bash
git add showcase/integrations/crewai-crews/src \
  showcase/integrations/crewai-crews/tests/python/test_interrupt_flow.py \
  showcase/aimock/d6/crewai-crews/gen-ui-interrupt.json \
  showcase/aimock/d6/crewai-crews/interrupt-headless.json
git commit -m "feat(showcase): add native CrewAI Flow interrupts"
git push
```

### Task 4: Add dedicated state, multimodal, and MCP backends

**Files:**

- Create: `showcase/integrations/crewai-crews/tests/python/test_native_feature_flows.py`
- Create: `showcase/integrations/crewai-crews/src/agents/shared_state_read.py`
- Create: `showcase/integrations/crewai-crews/src/agents/shared_state_streaming.py`
- Create: `showcase/integrations/crewai-crews/src/agents/multimodal_agent.py`
- Modify: `showcase/integrations/crewai-crews/src/agents/mcp_apps_agent.py`
- Modify: `showcase/integrations/crewai-crews/src/agent_server.py`
- Modify: `showcase/integrations/crewai-crews/src/app/api/copilotkit/route.ts`
- Modify: corresponding files under `showcase/aimock/d6/crewai-crews/`

- [ ] **Step 1: Write failing state and content-shape tests**

```python
async def test_streaming_flow_emits_each_document_revision(flow, emitted_states):
    await flow.write_document()
    assert [s["document"]["status"] for s in emitted_states] == [
        "researching",
        "drafting",
        "reviewing",
        "complete",
    ]


def test_multimodal_flow_preserves_content_parts(multimodal_flow):
    content = [
        {"type": "text", "text": "What is shown?"},
        {"type": "image", "url": "data:image/png;base64,AAAA"},
    ]
    assert multimodal_flow.model_messages(content)[-1]["content"] == content
```

Add an MCP registration test that verifies the endpoint uses the native CrewAI
MCP server/tool surface and contains no custom AG-UI event translation.

- [ ] **Step 2: Run tests and verify RED**

```bash
PYTHONPATH=showcase/integrations/crewai-crews:showcase/integrations/crewai-crews/src \
  python -m pytest \
  showcase/integrations/crewai-crews/tests/python/test_native_feature_flows.py -v
```

Expected: FAIL because read/stream/multimodal use the generic Crew path and MCP
is still described as unsupported.

- [ ] **Step 3: Implement minimal state Flows**

`shared_state_read` reads the frontend recipe/context state and streams a final
state snapshot. `shared_state_streaming` mutates one document state through the
four LangGraph-parity statuses and calls `copilotkit_emit_state` after each
mutation. Both complete with an assistant response from `copilotkit_stream`.

- [ ] **Step 4: Implement the dedicated multimodal Flow**

Preserve AG-UI content parts in state/messages and let the alpha bridge's
multimodal converter normalize them for LiteLLM. The endpoint must not flatten
images or PDFs into placeholder text.

- [ ] **Step 5: Use native MCP translation**

Keep only CrewAI MCP server/tool configuration in `mcp_apps_agent.py`. Let
`ag-ui-crewai` translate MCP lifecycle/tool events to
`TOOL_CALL_START/ARGS/END/RESULT`; do not synthesize those events locally.

- [ ] **Step 6: Register and route dedicated endpoints**

```python
add_crewai_flow_fastapi_endpoint(app, shared_state_read_flow, "/shared-state-read")
add_crewai_flow_fastapi_endpoint(
    app, shared_state_streaming_flow, "/shared-state-streaming"
)
add_crewai_flow_fastapi_endpoint(app, multimodal_flow, "/multimodal")
```

Map the matching `HttpAgent` names to these paths and preserve `/mcp-apps`.

- [ ] **Step 7: Validate fixtures and probes GREEN**

```bash
showcase/bin/showcase fixtures validate
showcase/bin/showcase test crewai-crews:shared-state-read --d6 --isolate
showcase/bin/showcase test crewai-crews:shared-state-streaming --d6 --isolate
showcase/bin/showcase test crewai-crews:multimodal --d6 --isolate
showcase/bin/showcase test crewai-crews:mcp-apps --d6 --isolate
```

- [ ] **Step 8: Commit and push**

```bash
git add showcase/integrations/crewai-crews/src \
  showcase/integrations/crewai-crews/tests/python/test_native_feature_flows.py \
  showcase/aimock/d6/crewai-crews
git commit -m "feat(showcase): complete CrewAI state media and MCP flows"
git push
```

### Task 5: Add A2UI recovery and enroll the four missing D6 families

**Files:**

- Create: `showcase/integrations/crewai-crews/tests/python/test_a2ui_recovery.py`
- Create: `showcase/integrations/crewai-crews/src/agents/a2ui_recovery.py`
- Create: `showcase/integrations/crewai-crews/src/app/demos/a2ui-recovery/chat.tsx`
- Create: `showcase/integrations/crewai-crews/src/app/demos/a2ui-recovery/page.tsx`
- Create: `showcase/integrations/crewai-crews/src/app/demos/a2ui-recovery/suggestions.ts`
- Create: `showcase/integrations/crewai-crews/src/app/api/copilotkit-a2ui-recovery/route.ts`
- Create: `showcase/aimock/d6/crewai-crews/a2ui-recovery.json`
- Modify: `showcase/integrations/crewai-crews/src/agent_server.py`
- Modify: `showcase/integrations/crewai-crews/manifest.yaml`

- [ ] **Step 1: Write a failing recovery-contract test**

```python
def test_recovery_plan_retries_then_heals(recovery_attempts):
    assert [attempt.status for attempt in recovery_attempts] == [
        "invalid",
        "valid",
    ]


def test_recovery_plan_exhausts_with_structured_failure(exhausted_result):
    assert exhausted_result["name"] == "a2ui_recovery_exhausted"
    assert exhausted_result["attempts"] == 3
```

- [ ] **Step 2: Run test and verify RED**

```bash
PYTHONPATH=showcase/integrations/crewai-crews:showcase/integrations/crewai-crews/src \
  python -m pytest \
  showcase/integrations/crewai-crews/tests/python/test_a2ui_recovery.py -v
```

- [ ] **Step 3: Implement backend-owned A2UI recovery**

Build the alpha bridge's `A2UITool/get_a2ui_tools` with the same CrewAI sales
context/catalog used by declarative A2UI. Configure an attempt callback,
three-attempt cap, healed result, and `a2ui_recovery_exhausted` result. Keep the
outer agent tool distinct from the middleware-intercepted inner `render_a2ui`.

- [ ] **Step 4: Port the LangGraph frontend byte-for-byte where backend-neutral**

Use the same two suggestions, catalog, test IDs, and layout. The only permitted
difference is the runtime URL pointing at the CrewAI API route. The runtime
route uses `HttpAgent({url: AGENT_URL + "/a2ui-recovery"})` and the same A2UI
middleware configuration as the LangGraph reference.

- [ ] **Step 5: Add the two deterministic recovery fixture branches**

The heal branch returns malformed stringified component/data args followed by
a valid surface. The exhaust branch returns invalid args for every allowed
attempt and asserts the failed fallback state.

- [ ] **Step 6: Enroll all four missing mappings and remove unsupported flags**

Add manifest demos for:

```yaml
- id: reasoning-default
- id: reasoning-custom
- id: shared-state-read
- id: declarative-json-render
- id: declarative-hashbrown
- id: a2ui-recovery
```

Remove the complete `not_supported_features` block after the corresponding
direct probes pass. The two declarative BYOC demo IDs replace the hidden
`byoc-*` enrollment aliases while continuing to use the existing CrewAI pages
and backend paths.

- [ ] **Step 7: Verify mapping and recovery GREEN**

```bash
pnpm --dir showcase/scripts validate-manifests
showcase/bin/showcase test crewai-crews:a2ui-recovery --d6 --isolate
showcase/bin/showcase test crewai-crews:declarative-hashbrown --d6 --isolate
showcase/bin/showcase test crewai-crews:declarative-json-render --d6 --isolate
```

Expected: CrewAI maps to exactly 41 D6 feature types with zero incapable skips.

- [ ] **Step 8: Commit and push**

```bash
git add showcase/integrations/crewai-crews \
  showcase/aimock/d6/crewai-crews/a2ui-recovery.json
git commit -m "feat(showcase): enroll CrewAI in all 41 D6 probes"
git push
```

### Task 6: Connect and update authored CrewAI parity documentation

**Files:**

- Modify: `showcase/integrations/crewai-crews/docs-links.json`
- Modify: `showcase/shell-docs/src/content/docs/integrations/crewai-flows/index.mdx`
- Modify: `showcase/shell-docs/src/content/docs/integrations/crewai-flows/meta.json`
- Create: `showcase/shell-docs/src/content/docs/integrations/crewai-flows/feature-parity.mdx`
- Modify: relevant authored pages for Flow HITL, A2UI, MCP, multimodal, reasoning,
  and state streaming when their examples still use superseded APIs.
- Modify: `showcase/integrations/crewai-crews/PARITY_NOTES.md`

- [ ] **Step 1: Write failing connected-doc assertions**

Extend the existing docs-link/registry validation test so every CrewAI manifest
demo resolves to a non-null shell-doc path and both declarative BYOC features
resolve to authored content:

```typescript
expect(resolveDocs("crewai-crews", "declarative-hashbrown")).toMatchObject({
  shellDocsPath: expect.any(String),
});
expect(resolveDocs("crewai-crews", "declarative-json-render")).toMatchObject({
  shellDocsPath: expect.any(String),
});
```

- [ ] **Step 2: Run docs validation and verify RED**

```bash
pnpm --dir showcase/shell-docs test
pnpm --dir showcase/shell-docs typecheck
```

Expected: missing BYOC/feature-parity routes fail resolution or content checks.

- [ ] **Step 3: Add explicit connected-doc mappings**

Map every CrewAI demo whose global fallback is absent, irrelevant, or points to
another CrewAI product. At minimum cover reasoning, Flow interrupts,
multimodal, MCP Apps, A2UI recovery, both declarative BYOC renderers, and all
shared-state variants.

- [ ] **Step 4: Document verified parity, not marketing claims**

Create `feature-parity.mdx` with:

- the 41/41 executed D6 contract;
- a capability table grouped by chat, tools/HITL, state, generative UI,
  multimodal/MCP, reasoning, and multi-agent;
- the fact that advanced showcase paths use CrewAI Flows;
- native bridge code examples for endpoint registration, including
  `emit_interrupt_outcome=True`;
- an alpha-validation note confined to the PR branch, written so the version
  line can be replaced cleanly by the official release before publication;
- links from each capability group to its detailed authored guide.

Delete stale parity notes that say reasoning, MCP, multimodal, or state
streaming are unsupported. Preserve genuine operational caveats.

- [ ] **Step 5: Update navigation and verify GREEN**

Add `feature-parity` to the authored `meta.json`, then run:

```bash
pnpm --dir showcase/shell-docs test
pnpm --dir showcase/shell-docs typecheck
pnpm --dir showcase/shell-docs build
```

Expected: routes load, sidebar selects the parity page, search indexes it, and
CrewAI framework switching retains the destination.

- [ ] **Step 6: Commit and push**

```bash
git add showcase/integrations/crewai-crews/docs-links.json \
  showcase/integrations/crewai-crews/PARITY_NOTES.md \
  showcase/shell-docs/src/content/docs/integrations/crewai-flows
git commit -m "docs(showcase): connect CrewAI full-parity guides"
git push
```

### Task 7: Run full parity, replay, and completion verification

**Files:**

- Modify only failing CrewAI backend/fixture/docs files identified by the
  shared probes; do not modify shared probes to special-case CrewAI.

- [ ] **Step 1: Run focused package validation**

```bash
PYTHONPATH=showcase/integrations/crewai-crews:showcase/integrations/crewai-crews/src \
  python -m pytest showcase/integrations/crewai-crews/tests/python -v
pnpm --dir showcase/integrations/crewai-crews build
showcase/bin/showcase fixtures validate
pnpm exec tsx showcase/scripts/validate-pins.ts
```

Expected: all focused tests and build checks pass.

- [ ] **Step 2: Run the full 41-cell D6 driver in one stable isolate**

```bash
showcase/bin/showcase test crewai-crews --d6 --verbose --cycle \
  --isolate crewai-full-d6-session --keep
```

Expected: aggregate reports `total=41`, `passed=41`, `failed=[]`,
`incapable=[]`.

- [ ] **Step 3: Fix failures narrow-to-broad**

For each red cell:

1. run the same LangGraph-Python cell in an isolated stack;
2. inspect aimock match logs;
3. compare raw SSE and frontend behavior;
4. write or tighten the CrewAI fixture/backend regression test;
5. watch it fail;
6. make the minimal CrewAI backend or fixture fix;
7. rerun the single CrewAI cell;
8. rerun the full 41-cell driver.

No shared-probe CrewAI conditional is permitted.

- [ ] **Step 4: Verify repeated/interleaved replay for changed pills**

Use the kept stack to exercise each changed suggestion once, five times, and
after another changed suggestion. Confirm aimock logs contain no misses or
order-dependent matches.

- [ ] **Step 5: Record selected real-provider checks through aimock**

Use the documented record-mode compose override for reasoning, native Flow
HITL/resume, multimodal, MCP, state streaming, and A2UI recovery. Convert the
recordings into stable CrewAI D6 fixtures and replay them locally. Never run an
unrecorded real-provider flow.

- [ ] **Step 6: Tear down the kept isolate**

Run the exact teardown command printed by the isolate survival notice,
including `--volumes` and removal of its run/slot directories.

- [ ] **Step 7: Run final review gates**

```bash
git diff --check origin/main...HEAD
pnpm nx affected -t lint,typecheck,test,build --base=origin/main
gh pr checks 6392
```

Expected: all applicable local checks pass and remaining remote checks, if any,
are identified by name and resolved.

- [ ] **Step 8: Commit final fixture corrections and push**

```bash
git add showcase/integrations/crewai-crews showcase/aimock/d6/crewai-crews
git commit -m "test(showcase): lock CrewAI full D6 replay"
git push
```

Do not mark the draft PR ready without the user's instruction.
