# Inspector pane map

Source of truth for which shipped Inspector pane has a docs Callout.
Update this file in the same change that adds or removes a pane.

| Shipped pane      | Docs page                                     | Callout snippet                                              | Notes                                                                             |
| ----------------- | --------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Agent             | Default web quickstart step                   | `snippets/shared/inspector/open-inspector-step.mdx`          | First check in the quickstart step                                                |
| AG-UI Events      | Default web quickstart step                   | `snippets/shared/inspector/open-inspector-step.mdx`          | Second check, after a chat message                                                |
| Threads           | Default web quickstart step, Threads overview | `open-inspector-step.mdx`, `open-inspector-pane-threads.mdx` | Unlocked or Enable Intelligence both count. Callout also names **Try from here**. |
| Playground        | no page yet                                   |                                                              | Workbench leaf. Threads **Try from here** copies into this scratch session.       |
| Try from here     | Threads overview                              | `open-inspector-pane-threads.mdx`                            | Overlay action on a real stored thread detail header.                             |
| Frontend Tools    | Frontend tools, human-in-the-loop overview    | `open-inspector-pane-frontend-tools.mdx`                     | HITL tools appear here when registered                                            |
| State             | Shared state                                  | `open-inspector-pane-state.mdx`                              | Thread detail tab                                                                 |
| Context           | `useAgentContext` / agent-readonly            | `open-inspector-pane-context.mdx`                            | Agents group                                                                      |
| Learning          | Enterprise Intelligence overview              | `open-inspector-pane-learning.mdx`                           | Primary nav                                                                       |
| Capabilities      | no page yet                                   |                                                              | Client tool and catalog toggles. No dedicated docs page in this slice             |
| Messages          | no page yet                                   |                                                              | Thread detail tab. Covered by Threads Callout                                     |
| Angular Inspector | Angular frontend getting-started              | `open-inspector-step-angular.mdx`                            | Install page first                                                                |

## Unshipped (no Callout)

- Emit events
- Pop-out window
- Home page
- Sidebar IA

## Surfaces that do not get the Open Inspector step

- React Native
- Channels
