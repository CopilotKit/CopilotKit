# React Native CopilotKit Demo

A bare React Native 0.85 app demonstrating `@copilotkit/react-native` with `useAgent` and `useCopilotKit` hooks.

> Make sure you have completed the [React Native environment setup](https://reactnative.dev/docs/set-up-your-environment) before proceeding.

## Prerequisites

- Node.js >= 22.11
- pnpm (workspace root uses pnpm)
- Ruby + Bundler (for CocoaPods on iOS)
- Xcode (iOS) and/or Android Studio (Android)

## Setup

### 1. Install monorepo dependencies

From the **repository root**:

```sh
pnpm install
```

### 2. Build the CopilotKit packages

The demo uses workspace-linked `@copilotkit/*` packages, so they need to be built first:

```sh
pnpm nx run-many -t build --projects=@copilotkit/core,@copilotkit/shared,@copilotkit/react-core,@copilotkit/react-native
```

### 3. Install CocoaPods (iOS only)

From this directory (`examples/v2/react-native/demo`):

```sh
bundle install
cd ios && bundle exec pod install && cd ..
```

## Running the app

### Start Metro

```sh
pnpm start
```

To clear Metro's cache (recommended after rebasing or changing native deps):

```sh
pnpm start -- --reset-cache
```

### iOS

In a separate terminal:

```sh
pnpm run ios
```

### Android

Make sure `ANDROID_HOME` is set. On macOS, add to your `~/.zshrc`:

```sh
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools
```

Then launch an emulator from Android Studio (or connect a physical device) and run:

```sh
pnpm run android
```

## Project structure

```
App.tsx              — CopilotKitProvider setup with runtime URL
src/ChatScreen.tsx   — Chat UI using useAgent + useCopilotKit hooks
index.js             — Entry point with polyfill imports
metro.config.js      — pnpm monorepo compatibility config
```

## Configuration

The app connects to a hosted CopilotKit runtime by default. To use a local runtime, edit `App.tsx`:

```tsx
// const RUNTIME_URL = "https://langgraph-py.examples.copilotkit.ai/api/copilotkit";
const RUNTIME_URL = "http://localhost:3000/api/copilotkit";
```

## Troubleshooting

- **Metro can't resolve modules**: Run `pnpm start -- --reset-cache` to clear the Metro cache.
- **CocoaPods errors**: Re-run `cd ios && bundle exec pod install`.
- **Android SDK not found**: Make sure `ANDROID_HOME` is set (see Android section above).
- **No emulators found**: Open Android Studio, go to Device Manager, and create/start an AVD.
- **Build failures after pulling changes**: Rebuild the CopilotKit packages (step 2 above).
- See the React Native [Troubleshooting guide](https://reactnative.dev/docs/troubleshooting) for general issues.
