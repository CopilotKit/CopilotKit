import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import CopilotTextarea from '../CopilotTextarea.vue';

describe('CopilotTextarea.vue', () => {
  let wrapper;
  let consoleLogSpy;

  beforeEach(() => {
    // Spy on console.log before each test
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {}); // Mock to suppress log output during tests
  });

  afterEach(() => {
    // Restore original console.log and unmount wrapper
    vi.restoreAllMocks();
    if (wrapper) {
      wrapper.unmount();
    }
  });

  // 1. Initial Rendering & Props
  describe('Initial Rendering & Props', () => {
    it('should render the textarea element', () => {
      wrapper = mount(CopilotTextarea);
      expect(wrapper.find('textarea.copilot-textarea').exists()).toBe(true);
    });

    it('should set textarea content with initialValue prop', () => {
      const initialText = 'Hello from prop';
      wrapper = mount(CopilotTextarea, {
        props: { initialValue: initialText },
      });
      expect(wrapper.find('textarea').element.value).toBe(initialText);
      expect(wrapper.vm.textContent).toBe(initialText); // Check internal state
    });

    it('should have an empty textarea if initialValue prop is not provided', () => {
      wrapper = mount(CopilotTextarea);
      expect(wrapper.find('textarea').element.value).toBe('');
      expect(wrapper.vm.textContent).toBe('');
    });

    it('should set the placeholder with placeholder prop', () => {
      const placeholderText = 'Enter your text here...';
      wrapper = mount(CopilotTextarea, {
        props: { placeholder: placeholderText },
      });
      expect(wrapper.find('textarea').attributes('placeholder')).toBe(placeholderText);
    });

    it('should use a default placeholder if placeholder prop is not provided', () => {
      wrapper = mount(CopilotTextarea);
      // The component defines 'Enter text here...' as the default
      expect(wrapper.find('textarea').attributes('placeholder')).toBe('Enter text here...');
    });
  });

  // 2. Data Binding (v-model)
  describe('Data Binding', () => {
    beforeEach(() => {
      wrapper = mount(CopilotTextarea);
    });

    it('should update textContent ref when textarea value changes', async () => {
      const newText = 'User typing...';
      const textarea = wrapper.find('textarea');
      await textarea.setValue(newText);
      expect(wrapper.vm.textContent).toBe(newText);
    });

    it('should update textarea value when textContent ref changes programmatically', async () => {
      // This test is more about Vue's reactivity, which is generally reliable.
      // We'll simulate an external change to the ref if it were possible,
      // but direct manipulation of wrapper.vm.textContent and then checking
      // textarea.element.value is the most straightforward way with @vue/test-utils.
      const newText = 'Programmatic update';
      wrapper.vm.textContent = newText; // Directly set the ref
      await wrapper.vm.$nextTick(); // Wait for Vue to update the DOM
      expect(wrapper.find('textarea').element.value).toBe(newText);
    });
  });

  // 3. Mocked Button Functionality
  describe('Mocked Button Functionality', () => {
    beforeEach(() => {
      wrapper = mount(CopilotTextarea);
    });

    it('should render "Trigger Autocomplete" button', () => {
      const button = wrapper.find('button.action-button'); // Assuming it's the first one
      expect(button.exists()).toBe(true);
      expect(button.text()).toContain('Trigger Autocomplete');
    });

    it('should call triggerAutocomplete method (and log to console) when "Trigger Autocomplete" button is clicked', async () => {
      // Since the method itself is not exposed from <script setup> for direct spying without instance methods,
      // we spy on console.log which it calls.
      const button = wrapper.findAll('button.action-button').at(0);
      await wrapper.vm.$nextTick(); // Ensure textContent is initialized
      
      await button.trigger('click');
      
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy).toHaveBeenCalledWith('Autocomplete triggered for text:', wrapper.vm.textContent);
    });

    it('should render "AI Edit" button', () => {
      const buttons = wrapper.findAll('button.action-button');
      expect(buttons.length).toBeGreaterThanOrEqual(2);
      const aiEditButton = buttons.at(1);
      expect(aiEditButton.exists()).toBe(true);
      expect(aiEditButton.text()).toContain('AI Edit');
    });

    it('should call aiEdit method (and log to console) when "AI Edit" button is clicked', async () => {
      const aiEditButton = wrapper.findAll('button.action-button').at(1);
      await wrapper.vm.$nextTick(); // Ensure textContent is initialized
      
      await aiEditButton.trigger('click');
      
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy).toHaveBeenCalledWith('AI Edit triggered for text:', wrapper.vm.textContent);
    });
    
    it('should pass current textContent to console.log for both buttons', async () => {
        const initialText = "Testing text content";
        wrapper = mount(CopilotTextarea, {
            props: { initialValue: initialText }
        });
        // Re-spy console.log for this specific test instance after remount
        consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});


        const autocompleteButton = wrapper.findAll('button.action-button').at(0);
        const aiEditButton = wrapper.findAll('button.action-button').at(1);

        await autocompleteButton.trigger('click');
        expect(consoleLogSpy).toHaveBeenCalledWith('Autocomplete triggered for text:', initialText);

        await aiEditButton.trigger('click');
        expect(consoleLogSpy).toHaveBeenCalledWith('AI Edit triggered for text:', initialText);
        
        expect(consoleLogSpy).toHaveBeenCalledTimes(2);
    });
  });
});
