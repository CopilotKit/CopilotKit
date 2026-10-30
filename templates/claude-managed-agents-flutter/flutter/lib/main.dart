import 'package:copilotkit_flutter/copilotkit_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

void main() => runApp(const ClaudeChatApp());

class ClaudeChatApp extends StatefulWidget {
  const ClaudeChatApp({super.key});

  @override
  State<ClaudeChatApp> createState() => _ClaudeChatAppState();
}

class _ClaudeChatAppState extends State<ClaudeChatApp> {
  static const runtimeUrl = String.fromEnvironment('RUNTIME_URL');
  int conversation = 0;

  @override
  Widget build(BuildContext context) {
    final uri = Uri.tryParse(runtimeUrl);
    final valid = uri != null && uri.hasScheme && uri.host.isNotEmpty;
    return MaterialApp(
      title: 'Claude chat',
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF5648C8)),
      ),
      home: valid
          ? CopilotKit(
              key: ValueKey(conversation),
              runtimeUrl: uri,
              child: CopilotChatProvider(
                agentId: 'default',
                child: ChatScreen(onNewChat: () {
                  setState(() => conversation++);
                }),
              ),
            )
          : const Scaffold(
              body: SafeArea(
                child: Center(
                  child: Padding(
                    padding: EdgeInsets.all(24),
                    child: Text(
                      'Set RUNTIME_URL when you start the app. See README.md for the command.',
                    ),
                  ),
                ),
              ),
            ),
    );
  }
}

class ChatScreen extends StatefulWidget {
  const ChatScreen({required this.onNewChat, super.key});

  final VoidCallback onNewChat;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final input = TextEditingController();

  @override
  void dispose() {
    input.dispose();
    super.dispose();
  }

  void send() {
    final text = input.text.trim();
    if (text.isEmpty) return;
    context.read<CopilotChatBloc>().add(ChatMessageSent(text));
    input.clear();
  }

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<CopilotChatBloc, CopilotChatState>(
      builder: (context, chat) => Scaffold(
        appBar: AppBar(
          title: const Text('Claude'),
          actions: [
            TextButton.icon(
              onPressed: chat.isRunning ? null : widget.onNewChat,
              icon: const Icon(Icons.add_comment_outlined),
              label: const Text('New chat'),
            ),
          ],
        ),
        body: SafeArea(
          child: Column(
            children: [
              Expanded(
                child: chat.rows.isEmpty
                    ? const Center(child: Text('Ask Claude a question.'))
                    : ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: chat.rows.length,
                        itemBuilder: (context, index) {
                          final row = chat.rows[index];
                          if (row is ChatToolCallRow) {
                            return ToolCallWidget(call: row.call);
                          }
                          final message = (row as ChatMessageRow).message;
                          final mine = message is UserMessage;
                          final text = switch (message) {
                            UserMessage(:final content) => content,
                            AssistantMessage(:final content) => content ?? '',
                            _ => '',
                          };
                          return Align(
                            alignment: mine
                                ? Alignment.centerRight
                                : Alignment.centerLeft,
                            child: Card.filled(
                              color: mine
                                  ? Theme.of(context).colorScheme.primaryContainer
                                  : Theme.of(context).colorScheme.surfaceContainer,
                              child: Padding(
                                padding: const EdgeInsets.all(12),
                                child: SelectableText(text),
                              ),
                            ),
                          );
                        },
                      ),
              ),
              if (chat.error != null)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Text(
                    'The message failed. Check the runtime and try again.',
                    style: TextStyle(color: Theme.of(context).colorScheme.error),
                  ),
                ),
              Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: input,
                        enabled: !chat.isRunning,
                        minLines: 1,
                        maxLines: 4,
                        textInputAction: TextInputAction.send,
                        onSubmitted: (_) => send(),
                        decoration: const InputDecoration(
                          hintText: 'Message Claude',
                          border: OutlineInputBorder(),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    if (chat.isRunning)
                      IconButton.filled(
                        tooltip: 'Stop',
                        onPressed: () => context
                            .read<CopilotChatBloc>()
                            .add(const ChatStopRequested()),
                        icon: const Icon(Icons.stop),
                      )
                    else
                      IconButton.filled(
                        tooltip: 'Send',
                        onPressed: send,
                        icon: const Icon(Icons.send),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
