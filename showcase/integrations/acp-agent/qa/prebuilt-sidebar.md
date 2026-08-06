# QA: Pre-Built: Sidebar — ACP Agent via Intelligence

## Prerequisites

- Intelligence has the ACP feature enabled for the project
- An external ACP relay is online with the configured runtime and agent ids
- `COPILOTKIT_ACP_CWD` is a non-secret selector the external agent accepts
- `/api/health` reports `agent: ok` for Intelligence admission; it does not probe the external relay
- For local dev, `npm run relay` is running in a second terminal

## Test Steps

### 1. Sidebar layout

- [ ] Open `/demos/prebuilt-sidebar`
- [ ] Confirm the sidebar starts open and shifts the main content
- [ ] Close and reopen it with the launcher
- [ ] Send `Give me a fun fact.`

### 2. ACP response

- [ ] Confirm text streams into the sidebar
- [ ] Confirm the main content stays usable while the run is active
