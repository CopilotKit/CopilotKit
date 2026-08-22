# CopilotKit Flutter

Flutter components for building [CopilotKit](https://www.copilotkit.ai)-powered
AI copilots and agents in Flutter apps.

> **Status: work in progress.** This package is currently just a library
> scaffold — no components have been added yet.

## Getting started

Add the package to your app's `pubspec.yaml`:

```yaml
dependencies:
  copilotkit_flutter:
    path: ../path/to/community/flutter
```

Then import it:

```dart
import 'package:copilotkit_flutter/copilotkit_flutter.dart';
```

## Development

This is a standard Flutter package.

```bash
flutter pub get      # install dependencies
flutter analyze      # run static analysis
flutter test         # run tests
```

## Widgetbook

Components are showcased with [Widgetbook](https://widgetbook.io). The
catalog entry point is [`widgetbook/main.dart`](widgetbook/main.dart) (empty
for now). Run it locally with:

```bash
flutter run -t widgetbook/main.dart          # native
flutter run -t widgetbook/main.dart -d chrome # web
```

On every push to `flutter/main`, the
[`flutter / widgetbook`](../../.github/workflows/flutter_widgetbook.yml)
GitHub Actions workflow builds the Widgetbook as a Flutter web app and
publishes it to the `gh-pages` branch for GitHub Pages.

## License

MIT — see the repository root [`LICENSE`](../../LICENSE).
