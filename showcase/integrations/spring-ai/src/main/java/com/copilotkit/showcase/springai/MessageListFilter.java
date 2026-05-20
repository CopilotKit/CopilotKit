package com.copilotkit.showcase.springai;

import com.agui.core.message.BaseMessage;
import com.agui.server.spring.AgUiParameters;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;

/**
 * Strips null entries from AG-UI message lists.
 *
 * <p>When Jackson's {@code FAIL_ON_INVALID_SUBTYPE} is disabled (see
 * {@link JacksonConfig}), messages with unrecognised {@code role} values
 * (e.g. "activity", "reasoning" sent by the CopilotKit runtime) deserialize
 * as {@code null} inside the {@code List<BaseMessage>}. If those nulls
 * reach {@code LocalAgent.combineMessages()}, the {@code message.getId()}
 * call NPEs and crashes the request.
 *
 * <p>This utility filters nulls at the controller boundary — before the
 * {@code AgUiParameters} object is handed to any agent.
 */
public final class MessageListFilter {

    private static final Logger log = LoggerFactory.getLogger(MessageListFilter.class);

    private MessageListFilter() {}

    /**
     * Removes null entries from the parameters' message list in place.
     * Returns the same parameters object for convenience chaining.
     */
    public static AgUiParameters filterNulls(AgUiParameters params) {
        if (params == null || params.getMessages() == null) {
            return params;
        }
        List<BaseMessage> messages = params.getMessages();
        int before = messages.size();
        messages.removeIf(m -> m == null);
        int removed = before - messages.size();
        if (removed > 0) {
            log.debug("Filtered {} null message(s) from AG-UI parameters "
                    + "(unrecognised role values)", removed);
        }
        return params;
    }
}
