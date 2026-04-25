# QA: Pre-Built Popup — Agno

## Prerequisites

- Demo is deployed at `/demos/prebuilt-popup`
- Agent backend healthy (`/api/health`)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/prebuilt-popup`; verify heading "Popup demo — look for the floating launcher" is visible
- [ ] Verify the popup is OPEN by default and exposes a themed placeholder "Ask the popup anything..."
- [ ] Verify the floating toggle launcher is present

### 2. Feature-Specific Checks

#### Suggestions

- [ ] Verify "Say hi" suggestion pill renders
- [ ] Click the pill; verify "Say hi from the popup!" sends and an assistant text response appears within 30s

#### Chat Round-Trip

- [ ] Type "Hello" into the popup input and click the send button; verify an assistant bubble appears

#### Popup Toggle

- [ ] Click the popup close button; verify the popup unmounts / hides
- [ ] Click the floating launcher; verify the popup re-mounts

### 3. Error Handling

- [ ] Empty message submit is a no-op
- [ ] Console has no uncaught errors
