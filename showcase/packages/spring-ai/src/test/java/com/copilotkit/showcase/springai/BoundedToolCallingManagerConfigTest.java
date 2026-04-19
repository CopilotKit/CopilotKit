package com.copilotkit.showcase.springai;

import com.copilotkit.showcase.springai.BoundedToolCallingManagerConfig.BoundedToolCallingManager;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.prompt.ChatOptions;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.model.tool.DefaultToolExecutionResult;
import org.springframework.ai.model.tool.ToolCallingManager;
import org.springframework.ai.model.tool.ToolExecutionResult;

import java.util.Collections;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link BoundedToolCallingManagerConfig.BoundedToolCallingManager}.
 *
 * <p>Covers: first-call pass-through, Nth-call returnDirect flip, counter
 * reset on fresh options, null-options short-circuit, counter eviction after
 * cap, and counter eviction on delegate exception.
 */
class BoundedToolCallingManagerConfigTest {

    private static ToolExecutionResult passThroughResult() {
        return DefaultToolExecutionResult.builder()
                .conversationHistory(Collections.emptyList())
                .returnDirect(false)
                .build();
    }

    private static Prompt promptWithOptions(ChatOptions options) {
        Prompt prompt = mock(Prompt.class);
        when(prompt.getOptions()).thenReturn(options);
        return prompt;
    }

    private static ChatResponse emptyChatResponse() {
        return new ChatResponse(Collections.emptyList());
    }

    @Test
    void firstCallBelowCap_delegatesThroughWithoutFlippingReturnDirect() {
        ToolCallingManager delegate = mock(ToolCallingManager.class);
        when(delegate.executeToolCalls(any(), any())).thenReturn(passThroughResult());

        BoundedToolCallingManager mgr = new BoundedToolCallingManager(delegate, 2);
        ChatOptions options = mock(ChatOptions.class);

        ToolExecutionResult result = mgr.executeToolCalls(promptWithOptions(options), emptyChatResponse());

        assertThat(result.returnDirect()).isFalse();
        assertThat(mgr.iterationCount(options)).isEqualTo(1);
    }

    @Test
    void nthCallAtCap_flipsReturnDirectTrue() {
        ToolCallingManager delegate = mock(ToolCallingManager.class);
        when(delegate.executeToolCalls(any(), any())).thenReturn(passThroughResult());

        BoundedToolCallingManager mgr = new BoundedToolCallingManager(delegate, 1);
        ChatOptions options = mock(ChatOptions.class);

        ToolExecutionResult result = mgr.executeToolCalls(promptWithOptions(options), emptyChatResponse());

        assertThat(result.returnDirect()).isTrue();
    }

    @Test
    void freshOptionsInstance_resetsCounter() {
        ToolCallingManager delegate = mock(ToolCallingManager.class);
        when(delegate.executeToolCalls(any(), any())).thenReturn(passThroughResult());

        // Cap high so the first turn doesn't flip.
        BoundedToolCallingManager mgr = new BoundedToolCallingManager(delegate, 5);
        ChatOptions turnA = mock(ChatOptions.class);
        ChatOptions turnB = mock(ChatOptions.class);

        mgr.executeToolCalls(promptWithOptions(turnA), emptyChatResponse());
        mgr.executeToolCalls(promptWithOptions(turnA), emptyChatResponse());
        assertThat(mgr.iterationCount(turnA)).isEqualTo(2);

        mgr.executeToolCalls(promptWithOptions(turnB), emptyChatResponse());
        assertThat(mgr.iterationCount(turnB)).isEqualTo(1);
        // Turn A's counter is independent of turn B.
        assertThat(mgr.iterationCount(turnA)).isEqualTo(2);
    }

    @Test
    void nullOptions_delegatesWithoutCappingAndWithoutSharedKey() {
        ToolCallingManager delegate = mock(ToolCallingManager.class);
        when(delegate.executeToolCalls(any(), any())).thenReturn(passThroughResult());

        BoundedToolCallingManager mgr = new BoundedToolCallingManager(delegate, 1);

        // Many calls with null options should never flip returnDirect, and
        // should never populate a null-keyed counter.
        for (int i = 0; i < 10; i++) {
            ToolExecutionResult result = mgr.executeToolCalls(promptWithOptions(null), emptyChatResponse());
            assertThat(result.returnDirect()).isFalse();
        }
        assertThat(mgr.hasCounter(null)).isFalse();
    }

    @Test
    void counterRemovedAfterCapHit_allowsNextTurnOnSameOptionsToStartFresh() {
        ToolCallingManager delegate = mock(ToolCallingManager.class);
        when(delegate.executeToolCalls(any(), any())).thenReturn(passThroughResult());

        BoundedToolCallingManager mgr = new BoundedToolCallingManager(delegate, 1);
        ChatOptions options = mock(ChatOptions.class);

        // First call hits cap immediately (cap=1) and removes the counter.
        ToolExecutionResult first = mgr.executeToolCalls(promptWithOptions(options), emptyChatResponse());
        assertThat(first.returnDirect()).isTrue();
        assertThat(mgr.hasCounter(options)).isFalse();
    }

    @Test
    void delegateException_clearsCounterAndRethrows() {
        ToolCallingManager delegate = mock(ToolCallingManager.class);
        RuntimeException boom = new RuntimeException("boom");

        BoundedToolCallingManager mgr = new BoundedToolCallingManager(delegate, 5);
        ChatOptions options = mock(ChatOptions.class);

        // Seed the counter with one successful increment, then swap the stub
        // to throw. Use do*.when so re-stubbing doesn't invoke the previous
        // behavior during recording.
        doReturn(passThroughResult()).when(delegate).executeToolCalls(any(), any());
        mgr.executeToolCalls(promptWithOptions(options), emptyChatResponse());
        assertThat(mgr.iterationCount(options)).isEqualTo(1);

        doThrow(boom).when(delegate).executeToolCalls(any(), any());
        assertThatThrownBy(() ->
                mgr.executeToolCalls(promptWithOptions(options), emptyChatResponse()))
                .isSameAs(boom);

        // Counter must not leak across a failed turn.
        assertThat(mgr.hasCounter(options)).isFalse();
    }

    @Test
    void nullOptionsDelegateException_rethrowsAndLogsWithoutTouchingCounter() {
        ToolCallingManager delegate = mock(ToolCallingManager.class);
        RuntimeException boom = new RuntimeException("boom-null");
        when(delegate.executeToolCalls(any(), any())).thenThrow(boom);

        BoundedToolCallingManager mgr = new BoundedToolCallingManager(delegate, 1);

        assertThatThrownBy(() ->
                mgr.executeToolCalls(promptWithOptions(null), emptyChatResponse()))
                .isSameAs(boom);
        assertThat(mgr.hasCounter(null)).isFalse();
    }

    // AssistantMessage import present to force test compile against Spring-AI
    // so a stale transitive dep is caught at test-compile time rather than
    // run time. (Unused reference — instantiate cheaply.)
    @Test
    void springAiClasspathSanityCheck() {
        AssistantMessage m = new AssistantMessage("hi");
        assertThat(m.getText()).isEqualTo("hi");
    }
}
