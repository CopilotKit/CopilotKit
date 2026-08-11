/**
 * Smoke test for the app shell.
 *
 * `<App/>` mounts the CopilotKit provider tree, the state-based tab bar, and the
 * five screens. Two third-party concerns can't run under the default
 * `@react-native/jest-preset`:
 *
 *   1. `@copilotkit/react-native` pulls in `@ag-ui/client` → `uuid` as ESM,
 *      which the preset's `transformIgnorePatterns` does not transform (it only
 *      allow-lists a few RN packages). This is a pre-existing RN-test-env
 *      limitation, independent of this integration.
 *   2. `react-native-image-picker` is a native module with no JS implementation
 *      in the test environment.
 *
 * We therefore mock both at the module boundary so the test can verify the
 * app's OWN composition — provider wiring, tool mount point, tab bar, and the
 * upgraded ChatScreen — without a live runtime or native code. The CopilotKit
 * hooks are stubbed to inert values; the provider and tool components render
 * their children (or nothing), exactly as the real ones do at mount.
 */

import React from "react";
import ReactTestRenderer from "react-test-renderer";

// --- Mock the CopilotKit RN SDK (provider + headless hooks) ----------------
jest.mock("@copilotkit/react-native", () => {
  const RealReact = require("react");
  return {
    __esModule: true,
    // Provider + ReceiptTools render their children; tool hooks/components are
    // inert. `useReceiptCapture` is provided by the real ReceiptTools context in
    // production, but here ChatScreen reads from the mocked hook below.
    CopilotKitProvider: ({ children }: { children: React.ReactNode }) =>
      RealReact.createElement(RealReact.Fragment, null, children),
    useCopilotKit: () => ({
      copilotkit: {
        renderToolCalls: [],
        runAgent: jest.fn().mockResolvedValue(undefined),
        subscribe: () => ({ unsubscribe: () => {} }),
      },
      executingToolCallIds: new Set<string>(),
    }),
    useAgent: () => ({
      agent: { messages: [], isRunning: false, addMessage: jest.fn() },
    }),
    useFrontendTool: () => undefined,
    useHumanInTheLoop: () => undefined,
    useAttachments: () => ({
      processFiles: jest.fn().mockResolvedValue(undefined),
    }),
  };
});

// `@copilotkit/core` only contributes the ToolCallStatus enum to our code path.
jest.mock("@copilotkit/core", () => ({
  __esModule: true,
  ToolCallStatus: {
    InProgress: "inProgress",
    Executing: "executing",
    Complete: "complete",
  },
}));

// Native image picker — no JS impl in the test env.
jest.mock("react-native-image-picker", () => ({
  __esModule: true,
  launchCamera: jest.fn().mockResolvedValue({ didCancel: true }),
  launchImageLibrary: jest.fn().mockResolvedValue({ didCancel: true }),
}));

// react-native-safe-area-context's real SafeAreaProvider only renders children
// after an onLayout measurement, which never fires under react-test-renderer
// (children stay null). The library ships a jest mock, but it's authored as ESM
// inside node_modules and isn't transformed by the preset, so we inline an
// equivalent: providers that render children synchronously with zero insets.
jest.mock("react-native-safe-area-context", () => {
  const RealReact = require("react");
  const passthrough = ({ children }: { children: React.ReactNode }) =>
    RealReact.createElement(RealReact.Fragment, null, children);
  return {
    __esModule: true,
    SafeAreaProvider: passthrough,
    SafeAreaView: passthrough,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 320, height: 640 }),
    initialWindowMetrics: {
      frame: { x: 0, y: 0, width: 320, height: 640 },
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
    },
  };
});

import App from "../App";

test("mounts the app shell with all five tabs", async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<App />);
  });

  expect(tree).toBeDefined();

  // The state-based tab bar should render every tab label. Collect every
  // string anywhere in the rendered tree's props (robust to host-component
  // naming differences in react-test-renderer).
  const strings = new Set<string>();
  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      strings.add(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node && typeof node === "object" && "children" in (node as object)) {
      visit((node as { children: unknown }).children);
    }
  };
  visit(tree!.toJSON());

  for (const label of [
    "Dashboard",
    "Accounts",
    "Transactions",
    "Budgets",
    "Assistant",
  ]) {
    expect(strings).toContain(label);
  }
});
