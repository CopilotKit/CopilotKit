<script lang="ts">
  import CopilotKitProvider from "../../providers/CopilotKitProvider.svelte";
  import CopilotChat from "../../components/chat/CopilotChat.svelte";
  let inputValue = $state("first draft");
</script>

<button data-testid="update-chat-input" onclick={() => (inputValue = "updated draft")}>update</button>
<output data-testid="chat-input-value">{inputValue}</output>
<CopilotKitProvider runtimeUrl="https://runtime.test">
  <CopilotChat
    {inputValue}
    onInputChange={(value) => (inputValue = value)}
    welcomeScreen={false}
  />
</CopilotKitProvider>
