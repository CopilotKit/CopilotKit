<!--
Thank you for sending the PR! We appreciate you spending the time to work on these changes.

Help us understand your motivation by explaining why you decided to make this change.

You can learn more about contributing to appwrite here: https://github.com/copilotkit/copilotkit/blob/master/CONTRIBUTING.md

Happy contributing!

-->

## What does this PR do?

This PR introduces a **Observability Hooks** system for all major chat components (`CopilotChat`, `CopilotModal`, `CopilotPopup`, `CopilotSidebar`). This new functionality allows developers to subscribe to various user interaction and chat lifecycle events, enabling robust analytics, monitoring, and custom workflows.

This feature is designed to be **only active when a `publicApiKey` from CopilotKit Cloud is provided**.

### Key Features:

1.  **New `observabilityHooks` Prop**: A new optional prop has been added to all chat components to subscribe to events.
2.  **Comprehensive Event Coverage**: Includes 8 distinct events, such as `onMessageSent`, `onChatExpanded`, `onFeedbackGiven`, and more.

### Example Usage:

```tsx
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";

function App() {
  return (
    // CopilotChat is a panel component and needs a container with a defined height.
    <div style={{ height: "500px", width: "400px", margin: "auto" }}>
      <CopilotKit publicApiKey="YOUR_PUBLIC_API_KEY">
        <CopilotChat
          observabilityHooks={{
            onMessageSent: (message) => {
              console.log("Message sent by user:", message);
              analytics.track("ChatMessageSent", { message });
            },
            onFeedbackGiven: (messageId, type) => {
              console.log(`Feedback (${type}) for message:`, messageId);
              analytics.track("FeedbackGiven", { messageId, type });
            },
          }}
        />
      </CopilotKit>
    </div>
  );
}
```

## Related PRs and Issues

- Addresses a direct customer request for the ability to hook into chat events for internal analytics and monitoring purposes.

## Checklist

- [x] I have read the [Contribution Guide](https://github.com/copilotkit/copilotkit/blob/master/CONTRIBUTING.md)
- [x] If the PR changes or adds functionality, I have updated the relevant documentation
