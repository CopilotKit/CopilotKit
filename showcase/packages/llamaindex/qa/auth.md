# QA: Auth demo — LlamaIndex

## Prerequisites

- Demo is deployed and accessible

## Test Steps

### 1. Unauthenticated State

- [ ] Navigate to the auth demo page
- [ ] Verify the unauthenticated banner is visible
- [ ] Verify no chat input until authenticated

### 2. Authenticate

- [ ] Click the Authenticate button
- [ ] Verify the chat input becomes visible
- [ ] Send a message and verify the agent responds

### 3. Regression

- [ ] Log out and verify chat is locked again
- [ ] Verify requests sent without the token return 401
