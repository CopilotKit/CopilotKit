# QA: Pre-Built: Sidebar — ACP Agent via Intelligence

## Prerequisites

- Intelligence has the ACP feature enabled for the project
- `COPILOTKIT_ACP_AGENT_PROFILE_ID` names a trusted server profile
- `/api/health` reports `agent: ok`

## Test Steps

### 1. Sidebar layout

- [ ] Open `/demos/prebuilt-sidebar`
- [ ] Confirm the sidebar starts open and shifts the main content
- [ ] Close and reopen it with the launcher
- [ ] Send `Give me a fun fact.`

### 2. ACP response

- [ ] Confirm text streams into the sidebar
- [ ] Confirm the main content stays usable while the run is active
