package com.copilotkit.showcase.springai;

import com.agui.core.agent.AgentSubscriber;
import com.agui.core.agent.AgentSubscriberParams;
import com.agui.core.agent.RunAgentInput;
import com.agui.core.agent.RunAgentParameters;
import com.agui.core.message.BaseMessage;
import com.agui.core.state.State;
import com.agui.server.LocalAgent;
import com.copilotkit.showcase.springai.cvdiag.CvdiagBackend;
import com.copilotkit.showcase.springai.cvdiag.CvdiagRunContext;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

import static com.agui.server.EventFactory.runErrorEvent;

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
     *
     * <p><b>Future + worker-exception contract.</b> The SSE bridge
     * ({@code AgentStreamer.streamEvents}) drives the UI purely off the
     * {@link AgentSubscriber} callbacks ({@code onEvent} forwards each event,
     * {@code onRunFinalized}/{@code onRunFailed} close the stream) and
     * <em>discards</em> the {@link CompletableFuture} this method returns. The
     * stock {@link LocalAgent#runAgent} (and the previous version of this
     * override) returned a fresh future that was never completed and fired the
     * work via a discarded {@code runAsync}, so a worker-thread exception
     * thrown out of {@link #run} was swallowed silently — the SSE stream was
     * never finalized and the connection leaked until its {@code Long.MAX_VALUE}
     * timeout.
     *
     * <p>This override instead returns the {@code runAsync} future directly
     * (so any caller that <em>does</em> observe it sees real completion /
     * failure), and on a worker-thread exception emits a terminal
     * {@code RUN_ERROR} event and finalizes the run via
     * {@code onRunFailed} so the SSE stream closes deterministically. Normal
     * runs finalize through the subscriber callbacks the agent body already
     * emits, exactly as before.
     */
    @Override
    public CompletableFuture<Void> runAgent(RunAgentParameters parameters, AgentSubscriber subscriber) {
        // Captured on the CALLING thread (Tomcat request thread), where the
        // inbound HandlerInterceptor has populated the header context. This MUST
        // happen before the runAsync hop — afterCompletion() will clear the
        // request thread's binding once the controller returns the SseEmitter.
        final Map<String, String> capturedHeaders = AimockHeaderContext.capture();
        // Capture the CVDIAG run on the request thread too, so the agent body —
        // which runs on the pooled worker — can emit the agent/LLM/SSE
        // boundaries against the same run an InheritableThreadLocal would lose.
        final CvdiagBackend.CvdiagRun capturedRun = CvdiagRunContext.capture();

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

        // Return the runAsync future directly so its completion / exceptional
        // completion is observable. handle() bridges a swallowed worker-thread
        // exception into a terminal RUN_ERROR + run-failed finalization so the
        // SSE stream is always closed, then re-propagates it to the returned
        // future for any caller that observes it.
        return CompletableFuture
                .runAsync(() ->
                        CvdiagRunContext.runWith(capturedRun, () ->
                                AimockHeaderContext.runWith(capturedHeaders,
                                        () -> this.run(input, subscriber))))
                .handle((unused, throwable) -> {
                    if (throwable != null) {
                        Throwable cause = throwable instanceof java.util.concurrent.CompletionException
                                && throwable.getCause() != null
                                ? throwable.getCause()
                                : throwable;
                        // CVDIAG backend.error.caught: a worker-thread exception
                        // escaped the agent body. Emit it here (the run is bound
                        // on the request thread that observes this handle()).
                        CvdiagBackend.CvdiagRun run = CvdiagRunContext.get();
                        if (run != null) {
                            run.errorCaught(cause);
                            run.agentExit(com.copilotkit.showcase.springai.cvdiag
                                    .CvdiagSchema.CvdiagOutcome.ERR);
                        }
                        // The agent body failed before (or without) emitting its
                        // own terminal events. Emit RUN_ERROR so any connected
                        // client tears down the run, then finalize via
                        // onRunFailed so the EventStream closes the SseEmitter.
                        this.emitEvent(runErrorEvent(String.format(
                                "agent run failed: %s (see server logs)",
                                cause.getClass().getSimpleName())), subscriber);
                        subscriber.onRunFailed(
                                new AgentSubscriberParams(this.messages, this.state, this, input),
                                cause);
                        throw cause instanceof RuntimeException re
                                ? re
                                : new java.util.concurrent.CompletionException(cause);
                    }
                    return null;
                });
    }
}
