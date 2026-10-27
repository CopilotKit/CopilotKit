import 'package:claude_managed_flutter/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('shows setup guidance when the runtime URL is missing', (tester) async {
    await tester.pumpWidget(const ClaudeChatApp());

    expect(find.byType(MaterialApp), findsOneWidget);
    expect(find.textContaining('Set RUNTIME_URL'), findsOneWidget);
  });
}
