<script lang="ts">
  import CopilotKitProvider from "../../providers/CopilotKitProvider.svelte";
  import CopilotChat from "../../components/chat/CopilotChat.svelte";
  let inputValue = $state("first draft");
</script>

<button data-testid="update-chat-input" onclick={() => (inputValue = "updated draft")}>update</button>
<CopilotKitProvider runtimeUrl="https://runtime.test">
  <CopilotChat {inputValue} welcomeScreen={false} />
</CopilotKitProvider>
