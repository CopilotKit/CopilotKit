package com.copilotkit.showcase.springai;

import com.agui.core.agent.AgentSubscriber;
import com.agui.core.agent.AgentSubscriberParams;
import com.agui.core.agent.RunAgentInput;
import com.agui.core.agent.RunAgentParameters;
import com.agui.core.event.BaseEvent;
import com.agui.core.exception.AGUIException;
import com.agui.core.message.BaseMessage;
import com.agui.core.message.UserMessage;
import com.agui.core.state.State;
import com.agui.core.type.EventType;
import org.junit.jupiter.api.Test;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static com.agui.server.EventFactory.runErrorEvent;
import static com.agui.server.EventFactory.runFinishedEvent;
import static com.agui.server.EventFactory.runStartedEvent;
import static com.agui.server.EventFactory.textMessageEndEvent;
import static com.agui.server.EventFactory.textMessageStartEvent;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Error-path lifecycle hardening for {@link PropagatingLocalAgent} and its
 * controller subclasses (issue #74). Three invariants:
 *
 * <ol>
 *   <li><b>RUN_STARTED precedes RUN_ERROR.</b> AG-UI clients drop a RUN_ERROR
 *       that arrives without a started run, hanging the UI. Every error path —
 *       including the no-user-message / empty-content path that runs before the
 *       LLM call — must emit RUN_STARTED first.</li>
 *   <li><b>Null / empty user message is a handled error.</b> A present-but-empty
 *       user message must produce a RUN_ERROR + a finalized run rather than an
 *       uncaught NPE.</li>
 *   <li><b>The base-class future completes (success) / propagates (worker
 *       exception).</b> {@link PropagatingLocalAgent#runAgent} must return a
 *       future that actually completes, and on a swallowed worker-thread
 *       exception must emit a terminal RUN_ERROR and finalize the run via
 *       {@code onRunFailed} so the SSE stream closes — then propagate the
 *       failure to the returned future.</li>
 * </ol>
 *
 * <p>The invariants on the error-path event ordering are exercised through
 * {@link GuardedTestAgent}, a minimal {@link PropagatingLocalAgent} subclass
 * that reproduces the exact guarded prologue shared by every controller agent
 * (run-started first, then a null/empty-content guard) without making a real
 * LLM call. The base-class future contract is tested against the real
 * {@link PropagatingLocalAgent#runAgent} code path.
 */
class PropagatingLocalAgentLifecycleTest {

    /** Records every emitted event plus finalize/fail callbacks, in order. */
    private static final class RecordingSubscriber implements AgentSubscriber {
        final List<EventType> events = new CopyOnWriteArrayList<>();
        final AtomicReference<AgentSubscriberParams> finalized = new AtomicReference<>();
        final AtomicReference<Throwable> failed = new AtomicReference<>();

        @Override
        public void onEvent(BaseEvent event) {
            events.add(event.getType());
        }

        @Override
        public void onRunFinalized(AgentSubscriberParams params) {
            finalized.set(params);
        }

        @Override
        public void onRunFailed(AgentSubscriberParams params, Throwable error) {
            failed.set(error);
        }
    }

    /**
     * Minimal agent reproducing the shared guarded prologue. The {@code run}
     * body emits RUN_STARTED before reading the user message, null/empty-guards
     * the content, and on the happy path emits a started message + finalizes.
     */
    private static final class GuardedTestAgent extends PropagatingLocalAgent {
        GuardedTestAgent() {
            super("guarded-test", new State(), new ArrayList<>());
        }

        @Override
        protected void run(RunAgentInput input, AgentSubscriber subscriber) {
            this.combineMessages(input);
            String messageId = "m1";
            String threadId = input.threadId();
            String runId = input.runId();

            this.emitEvent(runStartedEvent(threadId, runId), subscriber);

            String userContent;
            try {
                userContent = this.getLatestUserMessage(messages).getContent();
            } catch (AGUIException e) {
                this.emitEvent(runErrorEvent("agent run failed: "
                        + e.getClass().getSimpleName()), subscriber);
                this.emitEvent(runFinishedEvent(threadId, runId), subscriber);
                subscriber.onRunFinalized(
                        new AgentSubscriberParams(input.messages(), state, this, input));
                return;
            }
            if (!StringUtils.hasText(userContent)) {
                this.emitEvent(runErrorEvent(
                        "agent run failed: user message was empty"), subscriber);
                this.emitEvent(runFinishedEvent(threadId, runId), subscriber);
                subscriber.onRunFinalized(
                        new AgentSubscriberParams(input.messages(), state, this, input));
                return;
            }

            this.emitEvent(textMessageStartEvent(messageId, "assistant"), subscriber);
            this.emitEvent(textMessageEndEvent(messageId), subscriber);
            this.emitEvent(runFinishedEvent(threadId, runId), subscriber);
            subscriber.onRunFinalized(
                    new AgentSubscriberParams(input.messages(), state, this, input));
        }
    }

    /** Agent whose body always throws, to exercise the worker-exception bridge. */
    private static final class ThrowingAgent extends PropagatingLocalAgent {
        ThrowingAgent() {
            super("throwing-test", new State(), new ArrayList<>());
        }

        @Override
        protected void run(RunAgentInput input, AgentSubscriber subscriber) {
            throw new IllegalStateException("boom");
        }
    }

    private static UserMessage userMessage(String id, String content) {
        UserMessage m = new UserMessage();
        m.setId(id);
        m.setContent(content);
        return m;
    }

    private static RunAgentParameters params(List<BaseMessage> messages) {
        return RunAgentParameters.builder()
                .threadId("t1")
                .runId("r1")
                .messages(messages)
                .build();
    }

    @Test
    void noUserMessage_emitsRunStartedBeforeRunError_andFinalizes() throws Exception {
        RecordingSubscriber sub = new RecordingSubscriber();
        // No user message in the list -> getLatestUserMessage throws AGUIException.
        new GuardedTestAgent().runAgent(params(new ArrayList<>()), sub)
                .get(5, TimeUnit.SECONDS);

        assertThat(sub.events).containsExactly(
                EventType.RUN_STARTED,
                EventType.RUN_ERROR,
                EventType.RUN_FINISHED);
        // RUN_STARTED strictly precedes RUN_ERROR (the headline #74 invariant).
        assertThat(sub.events.indexOf(EventType.RUN_STARTED))
                .isLessThan(sub.events.indexOf(EventType.RUN_ERROR));
        // Run is finalized so the SSE stream closes.
        assertThat(sub.finalized.get()).isNotNull();
    }

    @Test
    void emptyUserMessage_isHandledAsRunError_notNpe() throws Exception {
        RecordingSubscriber sub = new RecordingSubscriber();
        List<BaseMessage> messages = new ArrayList<>();
        messages.add(userMessage("u1", "")); // present but blank content

        new GuardedTestAgent().runAgent(params(messages), sub)
                .get(5, TimeUnit.SECONDS);

        assertThat(sub.events).containsExactly(
                EventType.RUN_STARTED,
                EventType.RUN_ERROR,
                EventType.RUN_FINISHED);
        assertThat(sub.finalized.get()).isNotNull();
        // No text-message events: the run errored before opening a message.
        assertThat(sub.events).doesNotContain(
                EventType.TEXT_MESSAGE_START, EventType.TEXT_MESSAGE_END);
    }

    @Test
    void happyPath_emitsFullLifecycle_andFutureCompletes() throws Exception {
        RecordingSubscriber sub = new RecordingSubscriber();
        List<BaseMessage> messages = new ArrayList<>();
        messages.add(userMessage("u1", "hello"));

        CompletableFuture<Void> future =
                new GuardedTestAgent().runAgent(params(messages), sub);
        future.get(5, TimeUnit.SECONDS); // base-class future actually completes

        assertThat(future).isCompleted();
        assertThat(sub.events).containsExactly(
                EventType.RUN_STARTED,
                EventType.TEXT_MESSAGE_START,
                EventType.TEXT_MESSAGE_END,
                EventType.RUN_FINISHED);
        assertThat(sub.failed.get()).isNull();
        assertThat(sub.finalized.get()).isNotNull();
    }

    @Test
    void workerThreadException_emitsRunError_finalizesViaOnRunFailed_andPropagates() {
        RecordingSubscriber sub = new RecordingSubscriber();
        List<BaseMessage> messages = new ArrayList<>();
        messages.add(userMessage("u1", "hello"));

        CompletableFuture<Void> future =
                new ThrowingAgent().runAgent(params(messages), sub);

        // The base class must propagate the worker-thread exception to the
        // returned future (it used to be swallowed by a discarded runAsync).
        assertThatThrownBy(() -> future.get(5, TimeUnit.SECONDS))
                .isInstanceOf(ExecutionException.class)
                .cause()
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("boom");

        // And it must emit a terminal RUN_ERROR + finalize via onRunFailed so
        // the SSE EventStream closes instead of leaking the connection.
        assertThat(sub.events).contains(EventType.RUN_ERROR);
        assertThat(sub.failed.get())
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("boom");
    }
}
