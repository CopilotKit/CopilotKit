# Testing the Frontend Race Condition Fix

This document describes how to test the frontend thread switching fix using the SimpleThreadManager component.

## What This Tests

The frontend fix (PR #2606) eliminates race conditions when switching between threads by using TanStack Query for centralized state management. This test UI demonstrates that:

1. Thread state properly loads when switching threads
2. No stale messages appear from other threads
3. Rapid thread switching works correctly
4. Each thread maintains independent conversation history

## Setup

### 0. Configure Environment Variables (First Time Only)

```bash
# Setup backend .env (REQUIRED - needs OPENAI_API_KEY)
cd examples/coagents-starter/agent-py
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY

# Setup frontend .env (OPTIONAL - for configuration like port/backend URL)
cd ../ui
cp .env.example .env
# No API key needed - the frontend uses ExperimentalEmptyAdapter and proxies to backend
```

### 1. Start the Backend (with PR #2605 changes)

```bash
cd examples/coagents-starter/agent-py
poetry install
poetry run python -m sample_agent.demo
```

### 2. Start the Frontend (with this PR's changes)

```bash
cd examples/coagents-starter/ui
pnpm install
pnpm dev
```

### 3. Open Browser

Navigate to http://localhost:3015

## Manual Test Plan

### Test 1: Basic Thread Creation

**Steps:**
1. Open the app - you should see a thread manager in the top-left with "Thread #1"
2. Send a message in the chat: "Hello from thread 1"
3. Wait for agent response
4. Click the "New" button in the thread manager
5. Verify a new thread (Thread #2) is created

**Expected Result:**
- ✅ New thread appears immediately
- ✅ Chat is empty (no messages from Thread #1)
- ✅ Thread manager shows "Thread #2"

### Test 2: Switching Between Threads

**Steps:**
1. In Thread #2, send message: "Hello from thread 2"
2. Wait for agent response
3. Click the triangle (▶) in the thread manager to expand
4. Click on "Thread #1" in the list
5. Verify you see "Hello from thread 1" and its response

**Expected Result:**
- ✅ Thread #1 messages appear correctly
- ✅ NO messages from Thread #2 appear
- ✅ Thread manager shows "Thread #1" as current

### Test 3: Rapid Thread Switching

**Steps:**
1. Create 3-4 threads with different messages in each
2. Rapidly switch between threads using the thread manager
3. For each thread, verify the correct messages appear

**Expected Result:**
- ✅ No stale messages from other threads
- ✅ No loading errors or race conditions
- ✅ Each thread shows only its own messages

### Test 4: Delete Thread

**Steps:**
1. Create 3 threads with different messages in each
2. Switch to Thread #1
3. Expand the thread manager to see other threads
4. Hover over Thread #2 in the list - a trash icon should appear
5. Click the trash icon to delete Thread #2
6. Verify Thread #2 is removed from the list

**Expected Result:**
- ✅ Thread #2 is deleted from the list
- ✅ You remain on Thread #1 (current thread unchanged)
- ✅ Thread #3 still exists in the list

**Steps (Delete Current Thread):**
1. Switch to Thread #3
2. Expand thread manager and delete Thread #3 (the current thread)
3. Verify you're automatically switched to Thread #1

**Expected Result:**
- ✅ Thread #3 is deleted
- ✅ Automatically switched to Thread #1
- ✅ No errors or blank state

**Steps (Cannot Delete Last Thread):**
1. Delete threads until only 1 remains
2. Try to delete the last thread

**Expected Result:**
- ✅ Alert appears: "Cannot delete the last thread"
- ✅ Thread is not deleted

### Test 5: Thread Persistence

**Steps:**
1. Create 2 threads with messages
2. Refresh the page (F5)
3. Check if threads are still listed

**Expected Result:**
- ⚠️ Threads are stored in memory only - they will be lost on refresh
- ✅ This is expected behavior for SimpleThreadManager
- ✅ Future RemoteThreadManager will persist to backend

### Test 6: Thread List UI

**Steps:**
1. Create multiple threads
2. Expand the thread manager
3. Check the thread list display

**Expected Result:**
- ✅ Thread names: "Thread #1", "Thread #2", etc.
- ✅ Thread IDs shown in gray below name (truncated)
- ✅ Timestamp shown for each thread ("5m ago", "1h ago", etc.)
- ✅ Current thread NOT shown in the list
- ✅ Clicking any thread switches to it

## Developer Notes

### SimpleThreadManager Data Structure

The `ThreadMetadata` type matches what will be used in the future `RemoteThreadManager`:

```typescript
type ThreadMetadata = {
  id: string;          // UUID
  name: string;        // "Thread #1", "Thread #2", etc.
  createdAt: Date;     // Creation timestamp
};
```

### Architecture

- **Thread ID Management**: Page component holds `threadId` state
- **Thread Tracking**: SimpleThreadManager tracks seen threads in local state
- **Thread Switching**: Changing `threadId` triggers CopilotKit to load new thread state
- **State Management**: TanStack Query handles caching and deduplication

### Future Integration

This component is designed to be easily replaced with `RemoteThreadManager` that will:
- Persist threads to backend database
- Support user authentication
- Allow thread renaming
- Provide thread search/filtering
- Share threads across devices

The data structure and API surface are intentionally compatible with this future work.

## Common Issues

### Issue: Threads disappear on refresh
**Cause**: SimpleThreadManager uses in-memory storage
**Solution**: This is expected - use RemoteThreadManager for persistence

### Issue: Messages from wrong thread appear briefly
**Cause**: This indicates the frontend fix is NOT working
**Solution**: Verify TanStack Query is properly installed and useAgentStateQuery is being used

### Issue: Thread manager doesn't expand
**Cause**: Only one thread exists
**Solution**: Create a second thread - expand icon only appears with 2+ threads

## Success Criteria

The fix is working correctly if:
- ✅ Each thread maintains separate message history
- ✅ Switching threads shows correct messages immediately
- ✅ No stale messages appear from other threads
- ✅ Rapid switching works without errors
- ✅ Thread deletion works correctly (removes thread, switches if current)
- ✅ Thread list UI is clean and functional
