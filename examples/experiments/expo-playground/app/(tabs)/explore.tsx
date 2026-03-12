// IMPORTANT: react-native-get-random-values must be imported first before any other imports
// that use random value generation (like uuid and @ag-ui/client). This polyfill needs to be loaded before
// crypto.getRandomValues is used.
import 'react-native-get-random-values';

import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { HttpAgent } from '@ag-ui/client';
import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react';
import { v4 } from 'uuid';
const randomUUID = () => {
  return v4();
};

// Use platform-specific host to reach the development server
// Android emulator uses 10.0.2.2 to reach the host machine
// iOS simulator can use localhost
// For physical devices, replace with your laptop's local IP address (e.g., 192.168.1.x)
const getHost = () => {
  if (Platform.OS === 'android') {
    return '10.0.2.2'; // Android emulator special IP for host machine
  }
  return 'localhost'; // iOS simulator can use localhost
};

const agent = new HttpAgent({
  url: `http://${getHost()}:9001/agentic_chat/agui`,
});

const sendMessage = async (
  setMessageHistory: Dispatch<SetStateAction<string>>,
  rawMessage: string
): Promise<boolean> => {
  const message = rawMessage.trim();
  if (message.length === 0) {
    return false;
  }

  const setMessage = (newContent: string) => setMessageHistory((messageHistory) => messageHistory + newContent);

  agent.messages.push({
    id: randomUUID(),
    role: "user",
    content: message,
  });

  setMessage("🤖 USER: " + message + "\n\n====================\n\n");

  try {
    await agent.runAgent(
      {},
      {
        onTextMessageStartEvent() {
          setMessage("🤖 AG-UI assistant: ");
        },
        onTextMessageContentEvent({ event }) {
          setMessage(event.delta);
        },
        onTextMessageEndEvent() {
          setMessage("\n\n====================\n\n");
        },
        onToolCallStartEvent({ event }) {
          setMessage("🔧 Tool call: " + event.toolCallName + "\n");
        },
        onToolCallArgsEvent({ event }) {
          setMessage(event.delta);
        },
        onToolCallEndEvent() {
          setMessage("\n\n====================\n\n");
        },
        onToolCallResultEvent({ event }) {
          if (event.content) {
            setMessage("🔍 Tool call result: " + event.content + "\n");
          }
        },
      },
    );
  } catch (error) {
    setMessage("❌ Error running agent: " + error + "\n");
    return false;
  }
  return true;
}

export default function TabTwoScreen() {
  const [messageHistory, setMessageHistory] = useState(() => '');
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const isAtBottomRef = useRef(true);
  const scrollViewHeightRef = useRef(0);
  const scrollContentHeightRef = useRef(0);

  const backgroundColor = useThemeColor({}, 'background');
  const textColor = useThemeColor({}, 'text');
  const borderColor = useThemeColor({ light: '#ccc', dark: '#444' }, 'icon');

  const handleSend = async () => {
    if (isSending || !inputValue.trim()) {
      return;
    }

    // When sending a message, ensure we're at the bottom to follow the response
    isAtBottomRef.current = true;
    setIsSending(true);
    const success = await sendMessage(setMessageHistory, inputValue);
    setIsSending(false);

    if (success) {
      setInputValue('');
    }
  };

  const handleScroll = (event: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    scrollViewHeightRef.current = layoutMeasurement.height;
    scrollContentHeightRef.current = contentSize.height;

    // Check if user is at bottom (within 50px threshold)
    const threshold = 50;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    isAtBottomRef.current = distanceFromBottom < threshold;
  };

  const handleContentSizeChange = () => {
    // If user was at bottom, scroll to bottom when content size changes
    if (isAtBottomRef.current && scrollViewRef.current) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  };

  // Auto-scroll when messageHistory changes if user is at bottom
  useEffect(() => {
    if (isAtBottomRef.current && scrollViewRef.current) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messageHistory]);

  return (
    <View style={styles.container}>
      <ThemedView style={styles.titleContainer}>
        <ThemedText
          type="title"
          style={{
            fontFamily: Fonts.rounded,
          }}>
          AG-UI Messages
        </ThemedText>
      </ThemedView>

      <ThemedView style={[styles.messagesContainer,{ borderTopColor: borderColor }]}>
        <ScrollView
          ref={scrollViewRef}
          style={styles.messagesScrollView}
          onScroll={handleScroll}
          onContentSizeChange={handleContentSizeChange}
          scrollEventThrottle={16}>
          <ThemedText style={styles.messageText}>{messageHistory?.trim() || 'No messages yet'}</ThemedText>
        </ScrollView>
      </ThemedView>

      <ThemedView style={[styles.inputContainer, { borderTopColor: borderColor }]}>
        <TextInput
          style={[styles.input, { backgroundColor, color: textColor, borderColor }]}
          value={inputValue}
          onChangeText={setInputValue}
          placeholder="Type a message..."
          placeholderTextColor={borderColor}
          editable={!isSending}
          multiline
        />
        <Pressable
          style={[styles.sendButton, isSending && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={isSending || !inputValue.trim()}>
          <ThemedText style={styles.sendButtonText}>Send</ThemedText>
        </Pressable>
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    display: 'flex',
    flex: 1,
    flexDirection: 'column',
    flexGrow: 1,
    backgroundColor: '#FFFFFF',
    paddingTop: 64,
  },
  titleContainer: {
    paddingHorizontal: 32,
    flexDirection: 'row',
    gap: 8,
  },
  messagesContainer: {
    flex: 1,
    marginVertical: 16,
    borderRadius: 8,
    overflow: 'hidden',
    borderTopWidth: 1,
  },
  messagesScrollView: {
    flex: 1,
    padding: 16,
  },
  messageText: {
    padding: 32,
    fontFamily: Fonts.mono,
    fontSize: 14,
  },
  inputContainer: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-end',
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 16,
  },
  sendButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 40,
  },
  sendButtonDisabled: {
    backgroundColor: '#ccc',
    opacity: 0.6,
  },
  sendButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
