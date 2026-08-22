import 'package:flutter/material.dart';
import 'package:widgetbook/widgetbook.dart';

/// Entry point for the CopilotKit Flutter Widgetbook.
///
/// This is the workbook that showcases the components in
/// `package:copilotkit_flutter`. It is intentionally empty for now — add
/// [WidgetbookComponent]s with their use cases to [directories] as components
/// land in the library.
void main() {
  runApp(const CopilotKitWidgetbook());
}

class CopilotKitWidgetbook extends StatelessWidget {
  const CopilotKitWidgetbook({super.key});

  @override
  Widget build(BuildContext context) {
    return Widgetbook.material(
      // Component use cases are registered here as the library grows.
      directories: const [],
      addons: [
        MaterialThemeAddon(
          themes: [
            WidgetbookTheme(name: 'Light', data: ThemeData.light()),
            WidgetbookTheme(name: 'Dark', data: ThemeData.dark()),
          ],
        ),
        TextScaleAddon(),
        DeviceFrameAddon(devices: Devices.all),
      ],
    );
  }
}
