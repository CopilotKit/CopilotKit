package com.copilotkit.showcase.springai;

import com.copilotkit.showcase.springai.cvdiag.CvdiagBackend;
import com.copilotkit.showcase.springai.cvdiag.CvdiagRunContext;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

/**
 * CVDIAG {@code backend.error.caught} boundary for exceptions that escape a
 * controller before the agent body's own catch handles them (plan unit L1-G).
 *
 * <p>Registered only when the {@link CvdiagBackend} bean exists (i.e.
 * {@code cvdiag.backend.emitter=on}; default OFF) so it adds no error-handling
 * behavior in the normal configuration. It re-emits the original exception
 * through {@code response.status(500)} so the existing client contract is
 * unchanged; the CVDIAG emit is a side effect that never alters the response
 * body shape beyond the standard error.
 *
 * <p>Pure instrumentation: a CVDIAG failure here is swallowed by the emitter
 * and never masks the original exception.
 */
@RestControllerAdvice
@ConditionalOnBean(CvdiagBackend.class)
public class CvdiagExceptionAdvice {

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, String>> onException(Exception ex) {
        CvdiagBackend.CvdiagRun run = CvdiagRunContext.get();
        if (run != null) {
            run.errorCaught(ex);
        }
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", ex.getClass().getSimpleName()));
    }
}
