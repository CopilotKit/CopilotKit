package com.copilotkit.showcase.springai;

import com.agui.core.agent.AgentSubscriber;
import com.agui.core.agent.RunAgentInput;
import com.agui.core.agent.RunAgentParameters;
import com.agui.core.message.BaseMessage;
import com.agui.core.state.State;
import com.agui.server.LocalAgent;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * A {@link LocalAgent} that propagates the inbound {@code x-aimock-*} /
 * {@code x-test-id} headers across the AG-UI SDK's pooled-thread hop.
 *
 * <p><b>Why this exists.</b> The stock {@link LocalAgent#runAgent} dispatches
 * the agent body via {@link CompletableFuture#runAsync(Runnable)}, which runs
 * {@link #run(RunAgentInput, AgentSubscriber)} on a <em>pre-existing</em>
 * {@code ForkJoinPool.commonPool()} worker thread. Because
 * {@link AimockHeaderContext} is backed by an {@link InheritableThreadLocal}
 * (which only copies the parent value at thread <em>creation</em> time), the
 * pooled worker — created long before the request arrived — sees an empty map.
 * The outbound RestClient/WebClient interceptors then read an empty context and
 * drop {@code x-aimock-context} on the outbound LLM call, so aimock strict mode
 * 503s, the assistant message comes back empty, and the run errors.
 *
 * <p><b>What it does.</b> This override reproduces the SDK's {@code runAgent}
 * logic verbatim except that it {@linkplain AimockHeaderContext#capture()
 * captures} the headers on the calling (Tomcat request) thread — where
 * {@link AimockHeaderInterceptor} has already populated the context — and
 * {@linkplain AimockHeaderContext#runWith(Map, Runnable) re-establishes} that
 * snapshot on the worker thread immediately around the {@link #run} call. The
 * outbound interceptors then read the correct context regardless of which
 * thread the LLM call lands on.
 *
 * <p>This is the Java analogue of the {@code AsyncLocalStorage}-based
 * header-forwarding shim used by the TypeScript integrations (e.g. mastra's
 * {@code _header_forwarding.ts}): capture inbound {@code x-*} headers at the
 * request boundary, bind them for the duration of the LLM call, and restore.
 *
 * <p>Subclasses implement {@link #run(RunAgentInput, AgentSubscriber)} exactly
 * as they would against {@link LocalAgent}; the propagation is transparent.
 */
public abstract class PropagatingLocalAgent extends LocalAgent {

    protected PropagatingLocalAgent(
            final String agentId,
            final State state,
            final List<BaseMessage> messages) {
        super(agentId, state, messages);
    }

    /**
     * {@inheritDoc}
     *
     * <p>Overridden to capture the request-thread {@link AimockHeaderContext}
     * snapshot and re-establish it on the {@code runAsync} worker thread that
     * executes {@link #run}, so outbound LLM headers survive the SDK's
     * pooled-thread hop. Mirrors {@link LocalAgent#runAgent} otherwise.
     */
    @Override
    public CompletableFuture<Void> runAgent(RunAgentParameters parameters, AgentSubscriber subscriber) {
        // Captured on the CALLING thread (Tomcat request thread), where the
        // inbound HandlerInterceptor has populated the header context. This MUST
        // happen before the runAsync hop — afterCompletion() will clear the
        // request thread's binding once the controller returns the SseEmitter.
        final Map<String, String> capturedHeaders = AimockHeaderContext.capture();

        CompletableFuture<Void> future = new CompletableFuture<>();

        var input = new RunAgentInput(
                parameters.getThreadId(),
                Objects.isNull(parameters.getRunId())
                        ? UUID.randomUUID().toString()
                        : parameters.getRunId(),
                Objects.nonNull(parameters.getState())
                        ? parameters.getState()
                        : this.state,
                parameters.getMessages(),
                parameters.getTools(),
                parameters.getContext(),
                parameters.getForwardedProps()
        );

        CompletableFuture.runAsync(() ->
                AimockHeaderContext.runWith(capturedHeaders, () -> this.run(input, subscriber)));

        return future;
    }
}
