import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import CopilotPopup from '../CopilotPopup.vue';

// Helper function to mock fetch
const mockFetch = (data, ok = true) => {
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok,
      json: () => Promise.resolve(data),
    })
  );
};

const mockFetchError = (error = new Error('Network error')) => {
  global.fetch = vi.fn(() => Promise.reject(error));
};


describe('CopilotPopup.vue', () => {
  let wrapper;

  beforeEach(() => {
    // Mount a fresh component before each test
    wrapper = mount(CopilotPopup);
  });

  afterEach(() => {
    // Clean up mocks and unmount wrapper
    vi.restoreAllMocks();
    if (wrapper) {
      wrapper.unmount();
    }
  });

  // 1. Initial Rendering
  describe('Initial Rendering', () => {
    it('should show the toggle button on mount', () => {
      expect(wrapper.find('.popup-toggle-button').exists()).toBe(true);
      expect(wrapper.find('.popup-toggle-button').isVisible()).toBe(true);
    });

    it('should initially hide the chat window', () => {
      expect(wrapper.find('.chat-popup').exists()).toBe(false);
    });
  });

  // 2. Toggle Functionality
  describe('Toggle Functionality', () => {
    it('should show the chat window when toggle button is clicked', async () => {
      await wrapper.find('.popup-toggle-button').trigger('click');
      expect(wrapper.find('.chat-popup').exists()).toBe(true);
      expect(wrapper.find('.chat-popup').isVisible()).toBe(true);
    });

    it('should hide the chat window when toggle button is clicked twice', async () => {
      await wrapper.find('.popup-toggle-button').trigger('click'); // Open
      await wrapper.find('.popup-toggle-button').trigger('click'); // Close
      expect(wrapper.find('.chat-popup').exists()).toBe(false);
    });
  });

  // 3. Message Sending (Mocking fetch - Success)
  describe('Message Sending (Success)', () => {
    beforeEach(async () => {
      mockFetch({ message: 'AI: Hello there!' });
      // Open the popup
      await wrapper.find('.popup-toggle-button').trigger('click');
    });

    it('should send a message, display user and AI messages, and clear input', async () => {
      const input = wrapper.find('.input-area input[type="text"]');
      const sendButton = wrapper.find('.input-area button');
      
      await input.setValue('User: Hello');
      await sendButton.trigger('click');
      await nextTick(); // Wait for potential state updates and re-renders

      const messages = wrapper.findAll('.message-list .message');
      expect(messages.length).toBe(2); // User message + AI message

      // Check user message
      const userMessage = messages[0];
      expect(userMessage.text()).toContain('You: User: Hello');
      expect(userMessage.classes()).toContain('user-message');

      // Check AI message
      const aiMessage = messages[1];
      expect(aiMessage.text()).toContain('AI: AI: Hello there!');
      expect(aiMessage.classes()).toContain('ai-message');
      
      // Check input cleared
      expect(input.element.value).toBe('');

      // Check fetch was called
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith('/api/copilotkit', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: 'User: Hello' }),
      }));
    });

    it('should handle isLoading state during fetch', async () => {
        // Mock fetch with a slight delay to observe loading state
        global.fetch = vi.fn(() => 
            new Promise(resolve => 
                setTimeout(() => 
                    resolve({
                        ok: true,
                        json: () => Promise.resolve({ message: 'AI: Delayed response' }),
                    }), 
                50)
            )
        );

        const input = wrapper.find('.input-area input[type="text"]');
        const sendButton = wrapper.find('.input-area button');

        await input.setValue('Test loading');
        
        // Intentionally not awaiting the click here to check intermediate state
        sendButton.trigger('click');
        await nextTick(); // Allow Vue to react to the click (isLoading = true)

        // Assuming your button text changes or is disabled based on isLoading
        // Example: expect(sendButton.attributes('disabled')).toBeDefined();
        // Or, if text changes: expect(sendButton.text()).toContain('Sending...');
        // For this example, we'll check if isLoading is true in the component's data
        expect(wrapper.vm.isLoading).toBe(true); // Accessing component instance for state

        await nextTick(); // Wait for promises to resolve
        await nextTick(); // Wait for promises to resolve
        await nextTick(); // Wait for promises to resolve
        try { // Need to wait for the fetch mock's timeout
            await new Promise(resolve => setTimeout(resolve, 100)); 
        } catch (e) {}
        await nextTick();


        expect(wrapper.vm.isLoading).toBe(false); // Back to false after fetch completes
        const messages = wrapper.findAll('.message-list .message');
        expect(messages.length).toBe(2); // User + AI
    });
  });

  // 4. Message Sending (Mocking fetch - Failure)
  describe('Message Sending (Failure)', () => {
    beforeEach(async () => {
      // Open the popup
      await wrapper.find('.popup-toggle-button').trigger('click');
    });

    it('should display an error message if fetch fails with network error', async () => {
      mockFetchError(new Error('Network connection lost'));
      
      const input = wrapper.find('.input-area input[type="text"]');
      await input.setValue('User: Test Error');
      await wrapper.find('.input-area button').trigger('click');
      await nextTick(); // For fetch promise
      await nextTick(); // For UI update

      const messages = wrapper.findAll('.message-list .message');
      expect(messages.length).toBe(2); // User message + AI error message
      const aiMessage = messages[1];
      expect(aiMessage.text()).toContain('AI: Error: Network connection lost');
      expect(aiMessage.classes()).toContain('ai-message'); // Error shown as AI message
    });

    it('should display an error message if fetch returns !ok', async () => {
      mockFetch({ error: 'Server-side issue' }, false);

      const input = wrapper.find('.input-area input[type="text"]');
      await input.setValue('User: Test Server Error');
      await wrapper.find('.input-area button').trigger('click');
      await nextTick();
      await nextTick();

      const messages = wrapper.findAll('.message-list .message');
      expect(messages.length).toBe(2);
      const aiMessage = messages[1];
      expect(aiMessage.text()).toContain('AI: Error: Server-side issue');
    });
  });

  // 5. Message Display (Covered in message sending tests, but can add a specific one)
  describe('Message Display', () => {
    it('should apply distinct classes to user and AI messages', async () => {
      mockFetch({ message: 'AI says hi' });
      await wrapper.find('.popup-toggle-button').trigger('click');
      
      const input = wrapper.find('.input-area input[type="text"]');
      await input.setValue('User says hi');
      await wrapper.find('.input-area button').trigger('click');
      await nextTick();

      const userMessage = wrapper.find('.message.user-message');
      const aiMessage = wrapper.find('.message.ai-message');

      expect(userMessage.exists()).toBe(true);
      expect(aiMessage.exists()).toBe(true);
      expect(userMessage.text()).toContain('You: User says hi');
      expect(aiMessage.text()).toContain('AI: AI says hi');
    });
  });

  // 6. Input Validation (Empty Message)
  describe('Input Validation', () => {
    it('should not send a message if the input is empty', async () => {
      mockFetch({ message: 'This should not be called' });
      await wrapper.find('.popup-toggle-button').trigger('click');
      
      const sendButton = wrapper.find('.input-area button');
      await sendButton.trigger('click'); // Click with empty input
      await nextTick();

      expect(global.fetch).not.toHaveBeenCalled();
      const messages = wrapper.findAll('.message-list .message');
      expect(messages.length).toBe(0); // No messages should be added
    });

    it('should not send a message if the input is only whitespace', async () => {
        mockFetch({ message: 'This should not be called' });
        await wrapper.find('.popup-toggle-button').trigger('click');
        
        const input = wrapper.find('.input-area input[type="text"]');
        await input.setValue('   '); // Input with only spaces
        const sendButton = wrapper.find('.input-area button');
        await sendButton.trigger('click');
        await nextTick();
  
        expect(global.fetch).not.toHaveBeenCalled();
        const messages = wrapper.findAll('.message-list .message');
        expect(messages.length).toBe(0);
      });
  });
});
