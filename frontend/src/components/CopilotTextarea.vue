<template>
  <div class="copilot-textarea-container">
    <textarea
      v-model="textContent"
      :placeholder="placeholder"
      class="copilot-textarea"
    ></textarea>
    <div class="button-group">
      <button @click="triggerAutocomplete" class="action-button">
        Trigger Autocomplete
      </button>
      <button @click="aiEdit" class="action-button">
        AI Edit
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, defineProps, onMounted } from 'vue';

const props = defineProps({
  initialValue: {
    type: String,
    default: '',
  },
  placeholder: {
    type: String,
    default: 'Enter text here...',
  },
});

const textContent = ref('');

onMounted(() => {
  textContent.value = props.initialValue;
});

const triggerAutocomplete = () => {
  console.log('Autocomplete triggered for text:', textContent.value);
  // Placeholder for future AI autocompletion logic
};

const aiEdit = () => {
  console.log('AI Edit triggered for text:', textContent.value);
  // Placeholder for future AI editing logic
};
</script>

<style scoped>
/* Using variables for consistency, assuming they could be globally defined or inherited */
:root {
  --textarea-border-color: #ced4da;
  --textarea-focus-border-color: #5dade2; /* Theme color from App.vue */
  --textarea-bg-color: #ffffff;
  --button-primary-bg: #5dade2; /* Default button color from App.vue */
  --button-hover-bg: #4ca9d4; /* Default button hover color from App.vue */
  --button-text-color: white;
}

.copilot-textarea-container {
  display: flex;
  flex-direction: column;
  gap: 12px; /* Slightly increased gap */
  padding: 20px; /* Increased padding for better spacing, consistent with App.vue sections */
  border: 1px solid var(--textarea-border-color); /* Consistent border color */
  border-radius: 8px; /* Consistent with App.vue sections */
  background-color: #f8f9fa; /* Light background to subtly differentiate from page bg */
  box-shadow: 0 1px 4px rgba(0,0,0,0.04); /* Subtle shadow */
}

.copilot-textarea {
  width: 100%;
  min-height: 120px; /* Slightly taller */
  padding: 12px; /* Increased padding */
  border: 1px solid var(--textarea-border-color);
  border-radius: 6px; /* Slightly more rounded */
  font-size: 1rem;
  line-height: 1.5; /* Improved readability */
  box-sizing: border-box;
  background-color: var(--textarea-bg-color);
  color: #333;
  transition: border-color 0.2s ease-in-out, box-shadow 0.2s ease-in-out;
}

.copilot-textarea:focus {
  border-color: var(--textarea-focus-border-color);
  box-shadow: 0 0 0 0.2rem rgba(93, 173, 226, 0.25); /* Focus ring like Bootstrap */
  outline: none; /* Remove default outline */
}

.button-group {
  display: flex;
  gap: 12px; /* Consistent gap */
  justify-content: flex-start;
}

/* General action button styling, inherits from App.vue potentially but can be fine-tuned here */
.action-button {
  /* Leveraging global button styles from App.vue if not scoped,
     but defining specifics if needed or for overrides.
     Assuming App.vue styles provide the base for .button or button tags.
     If styles are strictly scoped, we'd repeat them or use :deep selectors. */
  background-color: var(--button-primary-bg);
  color: var(--button-text-color);
  padding: 10px 18px; /* Matching App.vue button padding */
  border-radius: 5px; /* Matching App.vue button radius */
  font-size: 0.95rem; /* Matching App.vue button font size */
  /* Other properties like border, cursor, transition should ideally be inherited
     or explicitly set here if App.vue styles aren't applying globally. */
  border: none;
  cursor: pointer;
  transition: background-color 0.2s ease, box-shadow 0.2s ease;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.action-button:hover {
  background-color: var(--button-hover-bg);
  box-shadow: 0 2px 5px rgba(0,0,0,0.15);
}

/* Example of a secondary button style if needed in the future */
.action-button.secondary {
  background-color: #6c757d; /* A common secondary color */
  color: white;
}

.action-button.secondary:hover {
  background-color: #5a6268;
}
</style>
