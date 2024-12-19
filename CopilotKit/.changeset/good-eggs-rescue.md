---
"@copilotkit/react-ui": patch
---

- fix: prevent sending empty messages via Enter key

When the input field was empty, pressing Enter would still trigger the
send() function despite the send button being correctly disabled. Added
the sendDisabled check to the onKeyDown handler to ensure consistent
validation between button and keyboard triggers.

- Added validation check to Enter key handler
- Ensures empty messages can't be sent via keyboard shortcut
- Makes behavior consistent with disabled send button state

Resolves #1129
