import 'package:copilotkit_flutter/copilotkit_flutter.dart';
import 'package:flutter/material.dart';
import 'package:widgetbook/widgetbook.dart';

/// Widgetbook catalog entry for [CopilotChatAssistantMessage].
WidgetbookComponent copilotChatAssistantMessageComponent() {
  return WidgetbookComponent(
    name: 'CopilotChatAssistantMessage',
    useCases: [
      WidgetbookUseCase(
        name: 'Default',
        builder: (context) {
          final message = context.knobs.string(
            label: 'Message',
            initialValue:
                'Hello! I\'m your CopilotKit assistant. How can I help you today?',
          );

          return Padding(
            padding: const EdgeInsets.all(16),
            child: CopilotChatAssistantMessage(message: message),
          );
        },
      ),
    ],
  );
}
