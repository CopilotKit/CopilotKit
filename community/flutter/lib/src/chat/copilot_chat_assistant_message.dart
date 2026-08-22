import 'package:flutter/material.dart';

/// A chat bubble that renders a single assistant (AI) message.
///
/// The bubble is aligned to the start of the row (the leading edge in the
/// current text direction) to distinguish it from user messages, which
/// typically align to the end. Colors are taken from the ambient
/// [ThemeData.colorScheme] so the component adapts to light and dark themes.
///
/// ```dart
/// CopilotChatAssistantMessage(
///   message: 'Hello! How can I help you today?',
/// )
/// ```
class CopilotChatAssistantMessage extends StatelessWidget {
  /// Creates an assistant message bubble displaying [message].
  const CopilotChatAssistantMessage({
    super.key,
    required this.message,
    this.backgroundColor,
    this.foregroundColor,
    this.padding = const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
    this.maxWidthFraction = 0.8,
  }) : assert(
          maxWidthFraction > 0 && maxWidthFraction <= 1,
          'maxWidthFraction must be in the range (0, 1].',
        );

  /// The assistant message text to display.
  final String message;

  /// The bubble's fill color.
  ///
  /// Defaults to [ColorScheme.surfaceContainerHigh] when null.
  final Color? backgroundColor;

  /// The color of the message text.
  ///
  /// Defaults to [ColorScheme.onSurface] when null.
  final Color? foregroundColor;

  /// Padding between the bubble's edge and the message text.
  final EdgeInsetsGeometry padding;

  /// The maximum width of the bubble as a fraction of the available width.
  ///
  /// Must be in the range `(0, 1]`.
  final double maxWidthFraction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Align(
      alignment: AlignmentDirectional.centerStart,
      child: LayoutBuilder(
        builder: (context, constraints) {
          return ConstrainedBox(
            constraints: BoxConstraints(
              maxWidth: constraints.maxWidth * maxWidthFraction,
            ),
            child: Container(
              padding: padding,
              decoration: BoxDecoration(
                color: backgroundColor ?? colorScheme.surfaceContainerHigh,
                borderRadius: const BorderRadiusDirectional.only(
                  topStart: Radius.circular(4),
                  topEnd: Radius.circular(16),
                  bottomEnd: Radius.circular(16),
                  bottomStart: Radius.circular(16),
                ),
              ),
              child: SelectableText(
                message,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: foregroundColor ?? colorScheme.onSurface,
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
