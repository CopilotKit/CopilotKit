# Realtime Gateway Error-Only Reconnect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an established managed Channels session recover when its WebSocket transport emits `error` without the `close` event Phoenix requires to schedule another connection.

**Architecture:** Add a private 100 ms watchdog beside the existing Realtime Gateway socket health observers. A normal close/open or intentional disconnect cancels it; otherwise it cycles the existing Phoenix socket through `disconnect` and `connect`, preserving Phoenix channel rejoin and public health semantics.

**Tech Stack:** TypeScript, Phoenix JavaScript client 1.8.4, Vitest, Nx, Node 22.

---

## File structure

- Modify `packages/channels-intelligence/src/realtime-gateway.test.ts`: extend the existing fake WebSocket control seam and add error-only recovery plus paired-event cancellation coverage.
- Modify `packages/channels-intelligence/src/realtime-gateway.ts`: add the private grace-period constant, watchdog lifecycle, and forced Phoenix socket cycle.
- Update `tasks/todo.md`: track the repository-local execution checklist.

### Task 1: Reproduce the Node 22 error-only reconnect stall

**Files:**

- Modify: `packages/channels-intelligence/src/realtime-gateway.test.ts:23-211`
- Test: `packages/channels-intelligence/src/realtime-gateway.test.ts:527-615`

- [ ] **Step 1: Add a one-shot error-only transport control**

Extend `FakeControl` and its initializer:

```ts
interface FakeControl {
  /** When set true, `give-up-then-recover` starts replying `ok` to rejoins. */
  recover: boolean;
  /** Make the next transport instance fail with `error` and no `close`. */
  failNextConnectWithErrorOnly: boolean;
}

const control: FakeControl = {
  recover: false,
  failNextConnectWithErrorOnly: false,
};
```

Capture and consume that one-shot flag in the fake constructor before its
microtask is queued, then model Node 22's failed upgrade:

```ts
constructor(public readonly url: string) {
  instances.push(this);
  const failWithErrorOnly = control.failNextConnectWithErrorOnly;
  control.failNextConnectWithErrorOnly = false;
  queueMicrotask(() => {
    if (failWithErrorOnly) {
      this.readyState = FakeWebSocket.CLOSED;
      this.onerror?.(transportErrorEvent("undici"));
      return;
    }
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  });
}
```

- [ ] **Step 2: Add the failing recovery regression**

Add this test to `connectRealtimeGateway — connection-health state (OSS-473)`:

```ts
it("recovers when a reconnect attempt emits error without close", async () => {
  const { FakeWebSocket, instances, control } = makeFakeWebSocket("ok");
  const { fetchImpl } = makeRespondingFetch(502);
  const session = await connectRealtimeGateway({
    wsUrl: "wss://gateway.example/channels",
    apiKey: "cpk-test",
    projectId: 7,
    join: {
      protocol: "channel_delivery_v1",
      runtimeInstanceId: "rti_1",
      channels: [{ channelName: "opentag", adapter: "slack" }],
    },
    webSocket: FakeWebSocket,
    diagnosticFetch: fetchImpl,
  });
  const states: RealtimeGatewayConnectionState[] = [];
  session.onStateChange((state) => states.push(state));

  control.failNextConnectWithErrorOnly = true;
  instances[0]!.serverClose(1006);

  await waitUntil(
    () => instances.length === 3 && states[states.length - 1] === "online",
  );
  expect(states).toContain("reconnecting");
  expect(instances).toHaveLength(3);
  expect(states[states.length - 1]).toBe("online");

  session.disconnect();
});
```

- [ ] **Step 3: Add the paired-event cancellation regression**

Add the companion test beside the recovery regression:

```ts
it("does not force another reconnect when error is followed by close", async () => {
  const { FakeWebSocket, instances } = makeFakeWebSocket("ok");
  const { fetchImpl } = makeRespondingFetch(502);
  const session = await connectRealtimeGateway({
    wsUrl: "wss://gateway.example/channels",
    apiKey: "cpk-test",
    projectId: 7,
    join: {
      protocol: "channel_delivery_v1",
      runtimeInstanceId: "rti_1",
      channels: [{ channelName: "opentag", adapter: "slack" }],
    },
    webSocket: FakeWebSocket,
    diagnosticFetch: fetchImpl,
  });
  const states: RealtimeGatewayConnectionState[] = [];
  session.onStateChange((state) => states.push(state));

  instances[0]!.onerror?.(transportErrorEvent("undici"));
  instances[0]!.serverClose(1006);

  await waitUntil(
    () => instances.length === 2 && states[states.length - 1] === "online",
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(instances).toHaveLength(2);

  session.disconnect();
});
```

- [ ] **Step 4: Run the package test target and verify the new regression fails**

Run:

```bash
eval "$(fnm env --shell zsh)" && fnm use 22 >/dev/null
pnpm nx run @copilotkit/channels-intelligence:test
```

Expected: the new `recovers when a reconnect attempt emits error without close`
test fails because `instances` remains at two and the state remains
`reconnecting`. Existing tests and the paired-event test pass.

### Task 2: Add the internal error-without-close watchdog

**Files:**

- Modify: `packages/channels-intelligence/src/realtime-gateway.ts:574-1128`
- Test: `packages/channels-intelligence/src/realtime-gateway.test.ts`

- [ ] **Step 1: Define the private grace period**

Add a module-private constant near the Realtime Gateway option declarations:

```ts
/** Allow transports to deliver their normal close event before intervening. */
const ERROR_WITHOUT_CLOSE_GRACE_MS = 100;
```

- [ ] **Step 2: Add watchdog lifecycle helpers**

Immediately before the socket drop-observer registrations, add:

```ts
let errorWithoutCloseTimer: ReturnType<typeof setTimeout> | undefined;
const clearErrorWithoutCloseTimer = (): void => {
  if (errorWithoutCloseTimer === undefined) return;
  clearTimeout(errorWithoutCloseTimer);
  errorWithoutCloseTimer = undefined;
};
const armErrorWithoutCloseTimer = (): void => {
  if (closingIntentionally || errorWithoutCloseTimer !== undefined) return;
  errorWithoutCloseTimer = setTimeout(() => {
    errorWithoutCloseTimer = undefined;
    if (closingIntentionally) return;
    socket.disconnect(() => {
      if (!closingIntentionally) socket.connect();
    });
  }, ERROR_WITHOUT_CLOSE_GRACE_MS);
  (errorWithoutCloseTimer as unknown as { unref?: () => void }).unref?.();
};
```

- [ ] **Step 3: Wire cancellation and arming into established-session events**

Update the existing socket hooks to clear on open/close and arm on error:

```ts
socket.onOpen(() => {
  clearErrorWithoutCloseTimer();
  closeFired = false;
});

socket.onClose((event) => {
  clearErrorWithoutCloseTimer();
  notifyClose();
  enterReconnecting();
  if (!closingIntentionally && event?.code === 1000) {
    socket.disconnect(() => {
      if (!closingIntentionally) socket.connect();
    });
  }
});

socket.onError(() => {
  notifyClose();
  enterReconnecting();
  armErrorWithoutCloseTimer();
});
```

Update the public teardown so it cannot leave a pending fallback behind:

```ts
disconnect: () => {
  closingIntentionally = true;
  clearErrorWithoutCloseTimer();
  clearGiveUpTimer();
  socket.disconnect();
},
```

- [ ] **Step 4: Run the package test target and verify green**

Run:

```bash
eval "$(fnm env --shell zsh)" && fnm use 22 >/dev/null
pnpm nx run @copilotkit/channels-intelligence:test
```

Expected: all 22 test files pass, including the two new tests; the test count is 214.

- [ ] **Step 5: Run the package type-check target**

Run:

```bash
eval "$(fnm env --shell zsh)" && fnm use 22 >/dev/null
pnpm nx run @copilotkit/channels-intelligence:check-types
```

Expected: Nx reports success with no TypeScript errors.

- [ ] **Step 6: Commit the tested behavior**

```bash
git add packages/channels-intelligence/src/realtime-gateway.ts packages/channels-intelligence/src/realtime-gateway.test.ts tasks/todo.md
git commit -m "fix(channels-intelligence): recover from error-only websocket failures"
git push
```

### Task 3: Verify the focused change and update the draft PR

**Files:**

- Inspect: `packages/channels-intelligence/src/realtime-gateway.ts`
- Inspect: `packages/channels-intelligence/src/realtime-gateway.test.ts`
- Update: draft PR `CopilotKit/CopilotKit#6443`

- [ ] **Step 1: Run package build and focused checks through Nx**

Run:

```bash
eval "$(fnm env --shell zsh)" && fnm use 22 >/dev/null
pnpm nx run-many -t test,check-types,build --projects=@copilotkit/channels-intelligence
```

Expected: every requested Nx target succeeds.

- [ ] **Step 2: Inspect the final diff for scope and whitespace errors**

Run:

```bash
git diff origin/main...HEAD --check
git diff origin/main...HEAD --stat
git status --short --branch
```

Expected: no whitespace errors, only the approved design/plan and two source
files are changed, and the branch is clean and synchronized with its remote.

- [ ] **Step 3: Update the draft PR body with final validation**

Edit PR `#6443` so its validation section reports the exact passing test count,
type-check result, and build result. Keep the PR in draft status.
