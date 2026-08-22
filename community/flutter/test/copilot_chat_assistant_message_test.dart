import 'package:copilotkit_flutter/copilotkit_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('CopilotChatAssistantMessage', () {
    testWidgets('renders the message text', (tester) async {
      const message = 'Hello from the assistant';

      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: CopilotChatAssistantMessage(message: message),
          ),
        ),
      );

      expect(find.text(message), findsOneWidget);
    });

    test('rejects an out-of-range maxWidthFraction', () {
      expect(
        () => CopilotChatAssistantMessage(
          message: 'x',
          maxWidthFraction: 1.5,
        ),
        throwsAssertionError,
      );
    });
  });
}
