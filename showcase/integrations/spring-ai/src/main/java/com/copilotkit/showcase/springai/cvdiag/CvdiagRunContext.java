package com.copilotkit.showcase.springai.cvdiag;

/**
 * Thread-local holder for the per-request {@link CvdiagBackend.CvdiagRun} so the
 * 11 backend boundaries (plan unit L1-G) can be emitted from handler sites that
 * do not share a method-call chain: the ingress interceptor mints the run, the
 * agent body emits the agent/LLM/SSE boundaries, and the
 * {@code @RestControllerAdvice} emits {@code backend.error.caught}.
 *
 * <p><b>Thread-handoff hazard (identical to {@code AimockHeaderContext}).</b>
 * The run is minted on the Tomcat request thread but the AG-UI SDK dispatches
 * the agent body via {@code CompletableFuture.runAsync} onto a pre-existing
 * {@code ForkJoinPool} worker, where an {@link InheritableThreadLocal} would
 * snapshot {@code null}. So {@link #capture()} / {@link #runWith} propagate the
 * run explicitly across that hop, exactly as {@code AimockHeaderContext} does
 * for the forwarded headers.
 *
 * <p>When CVDIAG backend emission is OFF the context is simply never populated
 * (the interceptor injects a {@code null} {@link CvdiagBackend}), so reads
 * return {@code null} and every call site no-ops.
 */
public final class CvdiagRunContext {

    private static final InheritableThreadLocal<CvdiagBackend.CvdiagRun> RUN =
            new InheritableThreadLocal<>();

    private CvdiagRunContext() {
        // utility class
    }

    /** Bind {@code run} to the current thread (called at ingress). */
    public static void set(CvdiagBackend.CvdiagRun run) {
        RUN.set(run);
    }

    /** The current thread's run, or {@code null} when unset / emission OFF. */
    public static CvdiagBackend.CvdiagRun get() {
        return RUN.get();
    }

    /** Clear the current thread's run (called at request completion). */
    public static void clear() {
        RUN.remove();
    }

    /** Snapshot the current run for explicit propagation across a thread hop. */
    public static CvdiagBackend.CvdiagRun capture() {
        return RUN.get();
    }

    /**
     * Run {@code body} with {@code run} bound to the current thread, restoring
     * the prior binding afterwards — the propagation primitive that carries the
     * request-thread run across the SDK's {@code runAsync} hop onto a pooled
     * worker. A {@code null} {@code run} runs the body with no binding.
     */
    public static void runWith(CvdiagBackend.CvdiagRun run, Runnable body) {
        if (run == null) {
            body.run();
            return;
        }
        CvdiagBackend.CvdiagRun previous = RUN.get();
        RUN.set(run);
        try {
            body.run();
        } finally {
            if (previous == null) {
                RUN.remove();
            } else {
                RUN.set(previous);
            }
        }
    }
}
