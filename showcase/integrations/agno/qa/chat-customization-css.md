# QA: Chat Customization (CSS) — Agno

## Prerequisites

- Demo deployed at `/demos/chat-customization-css`
- Agent backend healthy (`/api/health`)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/chat-customization-css`
- [ ] Verify the `.chat-css-demo-scope` wrapper is visible
- [ ] Verify the themed chat input (`data-testid="copilot-chat-input"`) is inside the scope

### 2. Feature-Specific Checks

#### CSS Variables

- [ ] Read computed styles on the scope:
  - `--copilot-kit-primary-color` = `#ff006e`
  - `--copilot-kit-background-color` = `#fff8f0`
  - `--copilot-kit-secondary-color` = `#fde047`

#### Input Font

- [ ] Verify the textarea uses Georgia serif font

#### Round-Trip Styling

- [ ] Send "hello"
- [ ] Verify the user bubble background is a hot-pink linear-gradient containing `rgb(255, 0, 110)`
- [ ] Verify the assistant bubble background is `rgb(253, 224, 71)` (amber `#fde047`)

### 3. Error Handling

- [ ] No uncaught console errors
