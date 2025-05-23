<template>
  <div>
    <button @click="togglePopup" class="popup-toggle-button">
      {{ isOpen ? 'Close Chat' : 'Open Chat' }}
    </button>

    <div v-if="isOpen" class="chat-popup">
      <div class="chat-header">Copilot Chat</div>
      <div class="message-list">
        <div
          v-for="message in messages"
          :key="message.id"
          :class="['message', message.sender === 'user' ? 'user-message' : 'ai-message']"
        >
          <p><strong>{{ message.sender === 'user' ? 'You' : 'AI' }}:</strong> {{ message.text }}</p>
        </div>
      </div>
      <div class="input-area">
        <input
          type="text"
          v-model="currentMessage"
          @keyup.enter="sendMessage"
          placeholder="Type your message..."
        />
        <button @click="sendMessage">Send</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';

const isOpen = ref(false);
const messages = ref([]);
const currentMessage = ref('');
const isLoading = ref(false); // Added for loading state

const togglePopup = () => {
  isOpen.value = !isOpen.value;
};

const sendMessage = async () => {
  if (currentMessage.value.trim() === '' || isLoading.value) {
    return;
  }

  isLoading.value = true;

  // Add user message to the list
  const userMessagePayload = {
    id: Date.now(),
    text: currentMessage.value,
    sender: 'user',
  };
  messages.value.push(userMessagePayload);

  const userMessageText = currentMessage.value;
  currentMessage.value = ''; // Clear input after capturing the message

  try {
    const response = await fetch('/api/copilotkit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: userMessageText }), // Backend expects { "message": "..." }
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const aiResponseText = data.message; // Backend returns { "message": "..." }

    messages.value.push({
      id: Date.now() + 1, // Ensure unique ID
      text: aiResponseText,
      sender: 'ai',
    });

  } catch (error) {
    console.error('Error sending message to backend:', error);
    messages.value.push({
      id: Date.now() + 1, // Ensure unique ID
      text: `Error: ${error.message || 'Could not connect to the AI assistant.'}`,
      sender: 'ai', // Display error as an AI message for simplicity
    });
  } finally {
    isLoading.value = false;
  }
};
</script>

<style scoped>
/* Using variables from a potential global scope or App.vue if not scoped */
:root {
  --chat-primary-color: #5dade2; /* Main theme color from App.vue */
  --chat-secondary-color: #4ca9d4; /* Hover color from App.vue */
  --chat-text-color: #333;
  --chat-bg-color: #ffffff;
  --chat-header-bg: #f8f9fa;
  --chat-border-color: #dfe6ec;
  --user-message-bg: var(--chat-primary-color);
  --user-message-text: white;
  --ai-message-bg: #e9ecef;
  --ai-message-text: var(--chat-text-color);
}

.popup-toggle-button {
  position: fixed;
  bottom: 25px; /* Slightly more offset */
  right: 25px;
  padding: 12px 22px; /* Increased padding */
  background-color: var(--chat-primary-color);
  color: white;
  border: none;
  border-radius: 8px; /* More rounded */
  cursor: pointer;
  z-index: 10000; /* Ensure it's above other elements */
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); /* Enhanced shadow */
  transition: background-color 0.2s ease, transform 0.2s ease;
}

.popup-toggle-button:hover {
  background-color: var(--chat-secondary-color);
  transform: translateY(-2px); /* Slight lift on hover */
}

.chat-popup {
  position: fixed;
  bottom: 95px; /* Adjusted to account for toggle button new size */
  right: 25px;
  width: 340px; /* Slightly wider */
  height: 480px; /* Slightly taller */
  background-color: var(--chat-bg-color);
  border: 1px solid var(--chat-border-color);
  border-radius: 12px; /* More pronounced rounding */
  box-shadow: 0 5px 20px rgba(0, 0, 0, 0.15); /* Enhanced shadow for popup */
  display: flex;
  flex-direction: column;
  z-index: 9999; /* Below toggle button but above most content */
  overflow: hidden; /* Ensures child elements conform to border radius */
}

.chat-header {
  padding: 15px; /* Increased padding */
  background-color: var(--chat-header-bg);
  border-bottom: 1px solid var(--chat-border-color);
  text-align: center;
  font-weight: 600; /* Slightly bolder */
  font-size: 1.1rem;
  color: var(--chat-text-color);
  /* No top-left/right radius needed due to parent overflow:hidden */
}

.message-list {
  flex-grow: 1;
  padding: 15px; /* Consistent padding */
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px; /* Space between messages */
  background-color: #fdfdfd; /* Slightly off-white for message area */
}

/* Custom scrollbar for message list */
.message-list::-webkit-scrollbar {
  width: 8px;
}
.message-list::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 10px;
}
.message-list::-webkit-scrollbar-thumb {
  background: #c5c5c5;
  border-radius: 10px;
}
.message-list::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}


.message {
  padding: 10px 15px; /* Increased padding */
  border-radius: 18px; /* More rounded messages */
  max-width: 85%; /* Slightly more width */
  line-height: 1.4;
  word-wrap: break-word; /* Ensure long words don't overflow */
}

.message p {
  margin: 0;
}

.message strong {
  font-weight: 600; /* More distinct sender name */
}

.user-message {
  background-color: var(--user-message-bg);
  color: var(--user-message-text);
  align-self: flex-end;
  border-bottom-right-radius: 6px; /* "Tail" effect */
}

.ai-message {
  background-color: var(--ai-message-bg);
  color: var(--ai-message-text);
  align-self: flex-start;
  border-bottom-left-radius: 6px; /* "Tail" effect */
}

.input-area {
  display: flex;
  align-items: center; /* Align items vertically */
  padding: 12px;
  border-top: 1px solid var(--chat-border-color);
  background-color: var(--chat-header-bg); /* Consistent with header */
}

.input-area input {
  flex-grow: 1;
  padding: 10px 12px; /* Comfortable padding */
  border: 1px solid #ced4da; /* Standard input border */
  border-radius: 20px; /* Pill-shaped input */
  margin-right: 10px;
  font-size: 0.95rem;
  outline: none; /* Remove default focus outline */
  transition: border-color 0.2s ease;
}

.input-area input:focus {
  border-color: var(--chat-primary-color); /* Highlight on focus */
}

.input-area button {
  padding: 10px 18px;
  background-color: var(--chat-primary-color);
  color: white;
  border: none;
  border-radius: 20px; /* Pill-shaped button */
  cursor: pointer;
  font-weight: 500;
  transition: background-color 0.2s ease;
}

.input-area button:hover {
  background-color: var(--chat-secondary-color);
}

.input-area button:disabled {
  background-color: #a9cce3;
  cursor: not-allowed;
}
</style>
