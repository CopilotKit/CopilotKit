# Claude Managed Agents + Flutter

This CLI template creates a Flutter chat app and a local Node runtime. Claude runs in a managed sandbox. CopilotKit Intelligence stores conversations and supplies published Skills to new Claude sessions.

The Flutter SDK is a beta project. This template pins one SDK revision. The setup command downloads that revision into `flutter/.sdk/`. The app and pinned SDK require stable Flutter 3.47 or later with Dart 3.13 or later, both below version 4. CI tests Flutter 3.47.0.

## Start the app

Check `flutter --version` before setup. Flutter bundles its own Dart SDK; updating a separate Dart installation does not fix a Flutter version mismatch. If you have Dart 3.12, run `flutter upgrade` and check the versions again. FVM users can run `fvm install 3.47.0` and put that SDK's `bin` directory on `PATH` before setup.

Run the CLI setup command:

```sh
copilotkit init --template claude-managed-agents-flutter --name my-claude-app
```

The CLI guides Ant login, project selection, and Claude agent setup. It installs the Node packages and prepares the Flutter app.

Start the runtime in one terminal:

```sh
cd my-claude-app
npm run dev
```

Start the app in a second terminal. Select the URL for your device:

| Device                | Runtime URL                                   |
| --------------------- | --------------------------------------------- |
| iOS simulator         | `http://localhost:8200/api/copilotkit`        |
| Android emulator      | `http://10.0.2.2:8200/api/copilotkit`         |
| Phone on your network | `http://YOUR_COMPUTER_IP:8200/api/copilotkit` |

For the iOS simulator, run:

```sh
cd my-claude-app/flutter
flutter run --dart-define=RUNTIME_URL=http://localhost:8200/api/copilotkit
```

If you use a phone, set `RUNTIME_HOST=0.0.0.0` before you start the runtime. Use a trusted network. The local runtime has no user login.

## Change the app

| Change                        | File                                  |
| ----------------------------- | ------------------------------------- |
| Chat screen                   | `flutter/lib/main.dart`               |
| Claude model and instructions | `anthropic/agents/assistant.md`       |
| Claude sandbox                | `anthropic/environments/sandbox.yaml` |
| Runtime                       | `server/index.ts`                     |
| Skill delivery                | `server/lib/native-skills.ts`         |

After you change the agent or sandbox, run `npm run agent:apply`. Start a new chat to use the new agent version. Published Intelligence Skills also reach new Claude sessions.

The app sends text and receives streamed replies. It can stop a run and start a new chat. The SDK does not provide the web starter's thread drawer or Inspector UI here.

## Run checks

```sh
npm test
npm run typecheck
npm run lint
cd flutter
flutter analyze
flutter test
```

If the CLI stopped at Flutter setup, fix the reported error, then run `npm run setup:flutter` and `npm run agent:apply` from the app root. The managed agent and environment still need to be created.

Run `npm run setup:flutter` to restore the pinned SDK and get Dart packages. Setup checks both versions before downloading or changing the SDK checkout. It prints upgrade instructions if the toolchain is too old. The SDK source stays in `flutter/.sdk/`. It is not committed with your app.

## Before public use

The runtime uses one local developer identity. Claude session mappings stay in server memory. Before public use, add verified user login, request limits, durable session storage, and tool permission rules.

The runtime keeps Anthropic and Intelligence credentials on the server. The Flutter app gets only the runtime URL.
