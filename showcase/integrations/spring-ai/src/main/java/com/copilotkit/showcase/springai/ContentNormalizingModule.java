package com.copilotkit.showcase.springai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.TextNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.MethodParameter;
import org.springframework.http.HttpInputMessage;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.RequestBodyAdviceAdapter;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Type;
import java.nio.charset.StandardCharsets;

/**
 * Pre-processes AG-UI request bodies to normalize array-format content fields
 * before Jackson deserialization.
 *
 * <p>The CopilotKit runtime re-invokes the agent after processing frontend
 * tool calls (e.g. {@code useRenderTool}). In the re-invocation payload,
 * assistant messages carry their {@code content} in the OpenAI multi-part
 * format:
 * <pre>{@code
 * "content": [{"type": "text", "text": "actual text here"}]
 * }</pre>
 *
 * <p>The AG-UI Java SDK's {@code BaseMessage.setContent(String)} expects a
 * plain {@code String}. Without normalization, Jackson throws
 * "Cannot deserialize value of type java.lang.String from Array value"
 * and the re-invocation fails with HTTP 400.
 *
 * <p>This advice intercepts the raw request body, scans for {@code messages[]}
 * entries whose {@code content} is an array, extracts the text, and rewrites
 * them as plain strings before Jackson processes the body.
 */
@ControllerAdvice
public class ContentNormalizingModule extends RequestBodyAdviceAdapter {

    private static final Logger log = LoggerFactory.getLogger(ContentNormalizingModule.class);
    private static final ObjectMapper RAW_MAPPER = new ObjectMapper();

    @Override
    public boolean supports(
            MethodParameter methodParameter,
            Type targetType,
            Class<? extends HttpMessageConverter<?>> converterType) {
        // Apply to all request bodies — the normalization is idempotent and
        // only modifies messages[] entries with array content.
        return true;
    }

    @Override
    public HttpInputMessage beforeBodyRead(
            HttpInputMessage inputMessage,
            MethodParameter parameter,
            Type targetType,
            Class<? extends HttpMessageConverter<?>> converterType)
            throws IOException {

        byte[] body = inputMessage.getBody().readAllBytes();
        String bodyStr = new String(body, StandardCharsets.UTF_8);

        // Only process JSON that looks like it contains messages
        if (!bodyStr.contains("\"messages\"")) {
            return createMessage(inputMessage, body);
        }

        try {
            JsonNode root = RAW_MAPPER.readTree(body);
            JsonNode messagesNode = root.get("messages");

            if (messagesNode == null || !messagesNode.isArray()) {
                return createMessage(inputMessage, body);
            }

            boolean modified = false;
            for (JsonNode msg : messagesNode) {
                if (msg == null || !msg.isObject()) continue;

                JsonNode contentNode = msg.get("content");
                if (contentNode != null && contentNode.isArray()) {
                    String extracted = extractTextFromArray((ArrayNode) contentNode);
                    ((ObjectNode) msg).set("content", new TextNode(extracted));
                    modified = true;
                }
            }

            if (modified) {
                byte[] normalized = RAW_MAPPER.writeValueAsBytes(root);
                log.debug("Normalized array content in {} message(s)", "messages");
                return createMessage(inputMessage, normalized);
            }
        } catch (Exception e) {
            // If normalization fails, pass the original body through unchanged.
            // Jackson will report the error normally.
            log.warn("Content normalization failed; passing original body", e);
        }

        return createMessage(inputMessage, body);
    }

    /**
     * Extracts and concatenates text from an OpenAI-style multi-part
     * content array. Each element is expected to have the shape
     * {@code {"type": "text", "text": "..."}}. Non-text elements are
     * skipped.
     */
    private static String extractTextFromArray(ArrayNode arrayNode) {
        StringBuilder sb = new StringBuilder();
        for (JsonNode elem : arrayNode) {
            if (elem.isTextual()) {
                sb.append(elem.asText());
            } else if (elem.isObject()) {
                JsonNode typeNode = elem.get("type");
                JsonNode textNode = elem.get("text");
                if (typeNode != null && "text".equals(typeNode.asText())
                        && textNode != null) {
                    sb.append(textNode.asText());
                }
            }
        }
        return sb.toString();
    }

    /**
     * Creates an HttpInputMessage wrapping the given body bytes while
     * preserving the original headers.
     */
    private static HttpInputMessage createMessage(
            HttpInputMessage original, byte[] body) {
        return new HttpInputMessage() {
            @Override
            public InputStream getBody() {
                return new ByteArrayInputStream(body);
            }

            @Override
            public org.springframework.http.HttpHeaders getHeaders() {
                return original.getHeaders();
            }
        };
    }
}
