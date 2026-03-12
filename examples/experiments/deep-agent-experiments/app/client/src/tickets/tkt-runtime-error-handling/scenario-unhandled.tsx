/**
 * Scenario: Unhandled runtime error (current behavior)
 *
 * Component tree:
 *   UserErrorBoundary
 *     └── CopilotKit (runtimeUrl="http://localhost:59999/nonexistent")
 *           └── CopilotChat
 *
 * On mount, CopilotKit tries to fetch /info from the runtimeUrl.
 * The fetch fails (ECONNREFUSED). The error propagates up and crashes
 * the component tree, hitting UserErrorBoundary.
 *
 * Expected: The error should NOT crash the tree. Instead, it should be
 * catchable via an onError callback or similar mechanism.
 */

import React, { useEffect } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-core/v2";

const TAG = "[tkt-runtime-error-handling][unhandled]";

// Simulates the user's own error boundary
class UserErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(TAG, "Error boundary caught:", error.message);
    console.error(TAG, "Component stack:", info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-4 bg-red-50 border border-red-300 rounded">
          <h3 className="font-bold text-red-800">
            Error boundary caught the error (this is the problem)
          </h3>
          <pre className="mt-2 text-sm text-red-700 whitespace-pre-wrap">
            {this.state.error.message}
          </pre>
          <p className="mt-2 text-sm text-red-600">
            The user has no way to handle this gracefully. They want an onError callback on
            CopilotKit that fires instead of crashing the tree.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

function CopilotChatInner() {
  useEffect(() => {
    console.log(TAG, "CopilotChat inner mounted — waiting for runtime connection...");
    return () => console.log(TAG, "CopilotChat inner unmounted");
  }, []);

  return (
    <CopilotChat
      className="h-[400px] border rounded"
      labels={{ title: "Chat (runtime is intentionally unreachable)" }}
    />
  );
}

export default function ScenarioUnhandled() {
  console.log(TAG, "Rendering with runtimeUrl=http://localhost:59999/nonexistent");

  return (
    <div>
      <p className="text-sm text-gray-600 mb-3">
        CopilotKit points at a non-existent runtime. The connection failure should crash this panel
        — demonstrating the error boundary problem.
      </p>
      {/* <UserErrorBoundary> */}
      <CopilotKit runtimeUrl="http://localhost:59999/nonexistent">
        <CopilotChatInner />
      </CopilotKit>
      {/* </UserErrorBoundary> */}
    </div>
  );
}
