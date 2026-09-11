# Inspector pane map

Source of truth for which shipped Inspector pane has a docs Callout.
Update this file in the same change that adds or removes a pane.

| Shipped pane      | Docs page                                        | Callout snippet                                              | Notes                                                                                                                    |
| ----------------- | ------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Agent             | Default web quickstart step                      | `snippets/shared/inspector/open-inspector-step.mdx`          | First check in the quickstart step                                                                                       |
| AG-UI Events      | Default web quickstart step                      | `snippets/shared/inspector/open-inspector-step.mdx`          | Second check, after a chat message                                                                                       |
| Threads           | Default web quickstart step, Threads overview    | `open-inspector-step.mdx`, `open-inspector-pane-threads.mdx` | Unlocked or Enable Intelligence both count. Callout also names **Try from here**.                                        |
| Playground        | Inspector overview                               |                                                              | Dedicated section explains the isolated scratch session and **Try from here**.                                           |
| Try from here     | Threads overview                                 | `open-inspector-pane-threads.mdx`                            | Overlay action on a real stored thread detail header.                                                                    |
| Frontend Tools    | Frontend tools, human-in-the-loop overview       | `open-inspector-pane-frontend-tools.mdx`                     | HITL tools appear here when registered                                                                                   |
| State             | Shared state                                     | `open-inspector-pane-state.mdx`                              | Thread detail tab                                                                                                        |
| Context           | `useAgentContext` / agent-readonly               | `open-inspector-pane-context.mdx`                            | Agents group                                                                                                             |
| Learning          | Learning guide, CopilotKit Intelligence overview | `open-inspector-pane-learning.mdx`                           | Primary nav; published Skills, supporting Insights, and Thread evidence                                                  |
| Capabilities      | no page yet                                      |                                                              | Client tool and catalog toggles. No dedicated docs page in this slice                                                    |
| Messages          | no page yet                                      |                                                              | Thread detail tab. Covered by Threads Callout                                                                            |
| Angular Inspector | Angular frontend getting-started                 | `open-inspector-step.mdx`                                    | Uses the shared step. `@copilotkit/angular` auto-mounts a pinned web-inspector, so there is nothing to install (OSS-948) |

## Unshipped (no Callout)

- Emit events
- Pop-out window

## Surfaces that do not get the Open Inspector step

Neither has a browser, so neither can mount the overlay. Each surface states the
absence and names what to use instead.

| Surface      | Where the absence is stated                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| React Native | `docs/inspector.mdx` "Where Inspector runs", and the Known limitations list on `docs/frontends/react-native.mdx` |
| Channels     | `docs/inspector.mdx` "Where Inspector runs"                                                                      |
