import 'package:flutter/material.dart';
import 'package:widgetbook/widgetbook.dart';

import 'components/copilot_chat_assistant_message.dart';

/// Entry point for the CopilotKit Flutter Widgetbook.
///
/// This is the workbook that showcases the components in
/// `package:copilotkit_flutter`. Register a component's [WidgetbookComponent]
/// in [directories] as it lands in the library.
void main() {
  runApp(const CopilotKitWidgetbook());
}

class CopilotKitWidgetbook extends StatelessWidget {
  const CopilotKitWidgetbook({super.key});

  @override
  Widget build(BuildContext context) {
    return Widgetbook.material(
      directories: [
        WidgetbookFolder(
          name: 'Chat',
          children: [
            copilotChatAssistantMessageComponent(),
          ],
        ),
      ],
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
