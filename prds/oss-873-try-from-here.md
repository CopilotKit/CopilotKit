# Try from here (Threads to Playground)

Linear: [OSS-873](https://linear.app/copilotkit/issue/OSS-873/new-features-add-a-new-fork-from-here-action-to-the-the-threads-view)

## Problem Statement

A developer opens a past thread in Inspector to see what the agent did. They want to try a follow-up, or retry the same conversation, without changing that stored thread.

Today they can read the thread. They cannot start a safe experiment from it on the Threads view. If they keep chatting in the app, they risk writing into the real thread. Playground can load a whole thread from its own header. The developer who is already on Threads must leave the thread, open Playground, and pick the thread again.

## Solution

The developer opens a real stored thread. The thread detail header shows **Try from here**.

A click copies the whole conversation (messages and thread state) into a new Playground scratch session. Inspector then opens Playground. The stored thread does not change.

The scratch session uses a new local thread id. Later Playground messages do not write back to the original thread.

If Playground already has a scratch chat, this click replaces it. There is no confirm dialog. If the copy fails, the developer stays on Threads. The old scratch session stays. An error appears next to the button.

The button is hidden on example tour threads and when thread inspect cannot load.

## User Stories

1. As a developer, I want a **Try from here** control on the thread I am viewing, so that I can experiment without leaving the conversation I just read.
2. As a developer, I want the control in the thread detail header, so that I do not hunt through the thread list.
3. As a developer, I want the label to read **Try from here**, so that the action sounds like a safe experiment, not a Git fork.
4. As a developer, I want one click to copy the whole thread, so that I do not pick messages one by one.
5. As a developer, I want the copy to include every stored message, so that the scratch chat matches the original conversation.
6. As a developer, I want the copy to include thread state, so that a retry can use the same agent state as that thread.
7. As a developer, I want the scratch session to use the thread's agent, so that the wrong agent does not answer.
8. As a developer, I want Inspector to switch to Playground after a successful copy, so that I can type the next message at once.
9. As a developer, I want the stored thread to stay unchanged after I chat in Playground, so that history stays a record of what happened.
10. As a developer, I want Playground to use a new scratch thread id, so that the runtime does not treat the copy as the original thread.
11. As a developer who already has a Playground scratch chat, I want Try from here to replace that scratch, so that I am not stuck with two sessions and no UI for a second one.
12. As a developer, I do not want a confirm dialog, so that the path matches Playground **Load a thread**.
13. As a developer, I want the copy to finish before Playground is replaced, so that a failed load does not wipe my current scratch.
14. As a developer whose copy fails, I want to stay on Threads, so that I am not sent to an empty Playground.
15. As a developer whose copy fails, I want an error next to **Try from here**, so that I know why nothing happened.
16. As a developer whose copy fails, I want to click **Try from here** again, so that a later success still works.
17. As a developer looking at an example tour thread, I do not want **Try from here**, so that a demo thread is not treated as a stored conversation.
18. As a developer whose Threads view is locked, I do not want **Try from here**, so that I am not offered an action that cannot load messages.
19. As a developer on a thread that cannot inspect, I do not want **Try from here**, so that a dead button does not sit in the header.
20. As a developer with no thread selected, I do not want **Try from here**, so that the empty detail pane stays empty.
21. As a developer, I want a loading state on the button while the copy runs, so that a double click does not start two loads.
22. As a developer who double-clicks, I want the second click to do nothing while the first load is in flight, so that Playground is replaced once.
23. As a developer whose Playground agent is mid-run, I want a successful Try from here to stop that run and then open the copy, so that the old scratch does not keep streaming.
24. As a developer, I want Playground **Load a thread** to keep working, so that I can still start from Playground without opening Threads.
25. As a developer, I want Playground **New thread** to keep working after Try from here, so that I can drop the copy and start empty.
26. As a developer, I want the Playground source-thread control to show this thread after a successful copy, so that I can see which thread I started from.
27. As a developer, I want Inspector agent scope to match the thread's agent after a successful copy, so that Playground and the header agree.
28. As a developer on **All Agents**, I want Try from here to still copy that one thread's agent, so that I do not have to change the dropdown first.
29. As a developer with two agents, I want a thread from agent B to open Playground on agent B, so that agent A does not receive the copy.
30. As a developer on an empty stored thread, I want Try from here to still run, so that I get an empty scratch with that thread's state.
31. As a developer whose messages request fails, I want the action to fail, so that Playground is not opened with a partial copy.
32. As a developer whose state request fails, I want messages to still copy and state to be empty, so that the path matches Playground **Load a thread**.
33. As a developer with no runtime URL, I want the action to fail with a visible error, so that I know the copy cannot load.
34. As a developer, I want core request headers to go with the load, so that authenticated runtimes still return messages and state.
35. As a keyboard user, I want **Try from here** to be a real button I can tab to, so that I do not need a pointer.
36. As a screen-reader user, I want the button name to be **Try from here**, so that the action is clear.
37. As a screen-reader user, I want a failed copy to expose the error next to the button, so that the failure is not silent.
38. As a developer in a popped-out Inspector, I want Try from here to work in that window, so that I do not have to dock back first.
39. As a developer using React, Vue, or the web component, I want the same control, so that the feature lives in Inspector, not in each wrapper.
40. As a developer on dark or light Inspector, I want the button to follow the current color scheme, so that the header stays readable.
41. As a developer, I want tool calls and tool results in the copy when the thread has them, so that the scratch conversation stays complete.
42. As a developer, I want later Playground runs to write only to the scratch session, so that Threads still shows the original messages.
43. As a QA tester, I want a successful copy to be assertable from the UI (Playground leaf open, original messages visible, new thread id), so that tests do not read private fields when public UI is enough.
44. As a QA tester, I want a failed copy to keep the Playground leaf unselected (or unchanged) and keep prior scratch messages, so that the no-wipe rule is testable.
45. As a telemetry reviewer, I want one coarse event with `outcome` success or failure, so that we can see if people use the control.
46. As a telemetry reviewer, I want no thread id and no message text in that event, so that Threads privacy rules still hold.
47. As a developer who opted out of telemetry, I want the click to still copy, so that analytics never block the action.
48. As a docs reader, I want Threads docs to mention **Try from here** after it ships, so that I can find the action without a Linear ticket.

## Implementation Decisions

- This work lives in the web Inspector. No new public React or Vue API. No new runtime route. No new package.
- Playground is a hard dependency. Try from here is an entry on Threads into the existing scratch Playground session.
- Reuse the Playground load contract:
  - `GET {runtimeUrl}/threads/{threadId}/messages` must succeed.
  - `GET {runtimeUrl}/threads/{threadId}/state` is best-effort. If it fails, use empty state.
  - Send the same core headers as Playground load.
  - Map stored thread messages onto Playground agent messages (user, assistant, tool), then `clone()` the source agent, assign a new Playground thread id, `setMessages`, `setState`.
- Fetch the snapshot first. Replace the scratch session only after a successful messages load. This is the control flow from the grill (not a demo):

```
snapshot = loadThread(threadId)
if snapshot.messagesFailed:
  showErrorOnThreads(error)
  return
replaceScratch(snapshot)  // clone agent, new thread id, messages + state
openLeaf("playground")
```

- After success, set the Playground source-thread id to this thread, switch Inspector leaf to Playground, and set agent scope to `thread.agentId`.
- While the load runs, disable **Try from here** and ignore extra clicks.
- On success, if a Playground run is active, abort it as part of replacing the scratch session (same teardown Playground already uses).
- Button placement: thread detail header only. Not on list rows. Not on messages.
- Visibility: real stored thread, thread inspect available, not an example tour thread, a thread is selected.
- Failure UI: stay on Threads. Keep the current Playground scratch. Show the error next to the button. Do not open Playground.
- Telemetry: one event in the existing Inspector Threads family, for example `oss.inspector.threads_try_from_here_clicked`, with `outcome: "success" | "failure"` plus the same coarse Threads fields (`leaf_key`, `runtime_mode`, license and usage buckets). No thread id. No message text. No runtime URL. Honor `telemetryDisabled`.
- Playground **Load a thread** and **New thread** stay as they are.
- Docs: this is an Inspector overlay action, not a new pane. When the button ships, update the Inspector pane map and the Threads Callout so they name **Try from here**. Do not add a Callout before the button ships.

## Testing Decisions

- Good tests assert what the developer sees and what the stored thread does not do. They do not assert private field names when a heading, button, or message list is enough.
- A good success test: open a real thread, click **Try from here**, see Playground, see the copied messages, see a different thread id, then send a Playground message and still see the original thread unchanged when returning to Threads.
- A good failure test: messages HTTP fails, the developer is still on Threads, the error is visible, Playground still has the previous scratch messages.
- A good visibility test: example tour thread has no **Try from here**. Locked Threads has no **Try from here**.
- A good privacy test: the telemetry payload has `outcome` and does not include thread id, message text, or runtime URL.
- Modules to test: web Inspector (thread detail header, copy flow, navigation to Playground, telemetry).
- Prior art:
  - Playground navigation and **Load a thread** tests in Inspector navigation specs.
  - Threads state, locked, and example-thread tests.
  - Threads telemetry privacy tests (forbidden fields and coarse buckets).

## Manual Testing Plan

Use the v2 react-router example with Inspector open (`showDevConsole="auto"`). Runtime must expose thread inspect (messages and, if present, state).

1. **Happy path.** Send two chat turns in the app. Open Inspector, open Threads, select that thread. Click **Try from here**. Confirm Inspector is on Playground, the messages match, and the Playground source control names that thread. Send a new Playground message. Return to Threads and confirm the stored thread does not include the new Playground message.
2. **Replace scratch.** In Playground, send a unique scratch message. Open Threads, select a different real thread, click **Try from here**. Confirm Playground shows the stored thread, not the unique scratch message.
3. **Fail and keep scratch.** Repeat step 2 so Playground has a unique scratch message. Break the messages request (stop the runtime, or block `/threads/.../messages`). Click **Try from here**. Confirm you stay on Threads, an error is next to the button, and Playground still has the unique scratch message.
4. **Hidden on examples.** Use a runtime with no real threads so the example tour list shows. Select an example thread. Confirm **Try from here** is absent.
5. **Hidden when locked.** Use a runtime with Threads locked. Confirm **Try from here** is absent.
6. **Empty thread.** If you can open a stored thread with no messages, click **Try from here**. Confirm Playground opens empty (or with state only) and does not error.
7. **Keyboard.** Tab to **Try from here** and activate it with Enter. Confirm the same success path as step 1.
8. **Two agents.** If the example exposes two agents, fork a thread that belongs to the non-default agent. Confirm Playground header shows that agent.

## Out of Scope

- Per-message fork (copy only up to a chosen message).
- A **Try from here** control on thread list rows.
- A confirm dialog before replacing Playground.
- A second concurrent Playground session.
- Copy from example tour threads.
- Edit, rename, delete, or append to the stored thread from this action.
- New runtime endpoints.
- New public frontend APIs or new Inspector panes.
- Sending thread ids or message bodies in telemetry.

## Further Notes

- Ticket title says "Fork from here". Shipped label is **Try from here**.
- Playground landed in CopilotKit/CopilotKit#6580. This spec assumes that Playground load and clone path is on main.
- State fetch failure is empty state, not a hard failure. That matches Playground **Load a thread** today.
- Suggested git branch from Linear: `alem/oss-873-new-features-add-a-new-fork-from-here-action-to-the-the`.
- Documentation impact (product docs, after the button ships, not in this file's job):
  - Reader: a developer who already uses Inspector Threads and wants to retry a conversation.
  - Update the Threads Inspector Callout and the Inspector pane map. Move **Try from here** out of Unshipped. Do not invent a new docs section unless Threads overview cannot hold one short Callout line.
  - Readers who do not use the web overlay (React Native, Channels) get no Open Inspector step for this action.
