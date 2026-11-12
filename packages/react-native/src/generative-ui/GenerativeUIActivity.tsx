import React, { useContext, useMemo } from "react";
import type { ComponentType, ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  GENERATIVE_UI_ACTIVITY_TYPE,
  GENERATIVE_UI_CHAT_TARGET,
} from "@copilotkit/shared";
import type { GenerativeUIRejectedOperation } from "@copilotkit/shared";
import {
  parseGenerativeUISurfaceContent,
  SurfaceView,
  useGenerativeUIActivitySurface,
  useGenerativeUIRuntime,
} from "@copilotkit/react-core/generative-ui/native";
import { GenerativeUIProviderPresentContext } from "./GenerativeUIProvider";
import { useDevelopmentWarnings } from "./internal";

/** The message shape this component reads: an AG-UI activity message. */
export interface GenerativeUIActivityMessage {
  id?: string;
  role: string;
  activityType?: string;
  content?: unknown;
}

/** Props of the wrapper around one generated surface. */
export interface GenerativeUIActivityWrapperProps {
  surfaceId: string;
  /** The agent is still writing this surface. */
  isStreaming: boolean;
  /**
   * Set when `rejected` is not empty. The message is generic; `error.cause`
   * holds the same list as `rejected`.
   */
  error?: Error;
  /**
   * The rejected operations of the latest `render_ui` call, with the
   * validator's reasons. When the surface is built again from its messages
   * (for example when the app restarts on a stored thread), the call
   * boundaries are not known, so the list can also hold rejections of
   * earlier calls on the surface.
   */
  rejected: GenerativeUIRejectedOperation[];
  /**
   * The surface. `null` when the agent's `createSurface` was rejected, so
   * the surface never existed: only `error` and `rejected` are set.
   */
  children: ReactNode;
}

export interface GenerativeUIActivityProps {
  /** An activity message from `agent.messages`. Other messages render nothing. */
  message: GenerativeUIActivityMessage;
  /** The agent whose messages these are (its thread owns the surface). */
  agent: { threadId?: string; agentId?: string } | undefined;
  /** Replaces the default wrapper around the surface. */
  Wrapper?: ComponentType<GenerativeUIActivityWrapperProps>;
  /**
   * The surface target this component shows. Defaults to `"chat"`, the
   * target of a surface the agent renders in the conversation, as in the
   * web chat. Surfaces of any other target render nothing.
   *
   * A surface aimed at a named target is drawn by the
   * `<GenerativeUISurface id>` with that id, so a chat list that renders
   * every activity message leaves it out and does not show it twice. The
   * agent can render into a named target only when a
   * `<GenerativeUISurface>` with that id was mounted when the run started
   * (the runtime rejects a `createSurface` for any other target), so this
   * prop does not make a target on its own. Set it to show a surface that the agent rendered into such a
   * target somewhere else, for example on a history screen after the user
   * left the screen with the `<GenerativeUISurface>`. While both are on
   * screen, the surface is drawn twice.
   */
  target?: string;
}

/**
 * True for the activity messages that carry a generated surface. A type
 * guard, so `agent.messages.filter(isGenerativeUIActivity)` gives activity
 * messages. It does not check the content: `<GenerativeUIActivity>` does.
 */
export function isGenerativeUIActivity<M extends GenerativeUIActivityMessage>(
  message: M,
): message is M & {
  role: "activity";
  activityType: typeof GENERATIVE_UI_ACTIVITY_TYPE;
} {
  return (
    message.role === "activity" &&
    message.activityType === GENERATIVE_UI_ACTIVITY_TYPE
  );
}

/**
 * The default wrapper: the surface, and an error line under it when
 * operations were rejected.
 *
 * It is the flex item of the parent, so it grows (`flexGrow: 1`) to fill
 * the free space of a parent with a fixed size, and the stretch default of
 * `alignItems` gives it the parent's cross size. A catalog root that sizes
 * itself against its parent (`flex: 1`, `flexGrow` or a percentage height)
 * then fills the parent, for example a screen that shows one surface.
 * In a list it does not: a `FlatList` cell and the content of a
 * `ScrollView` are as tall as their content, so there is no free space and
 * each row keeps its own height. Siblings in a parent with a fixed size, or
 * in a `ScrollView` whose `contentContainerStyle` grows, share its free
 * space. Pass a `Wrapper` for any other layout.
 */
export function DefaultGenerativeUIActivityWrapper({
  error,
  children,
}: GenerativeUIActivityWrapperProps) {
  return (
    <View style={styles.wrapper}>
      {children}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          Part of this UI couldn't be shown.
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Experimental. Shows the surface that an agent rendered with `render_ui`,
 * from its activity message. Put it wherever the app shows the agent's
 * output: in a chat list (one per activity message), or on a screen with no
 * chat at all, for example a home screen that an agent composes.
 *
 * Like the web chat, it shows only surfaces whose target is `"chat"`. A
 * surface aimed at a `<GenerativeUISurface id>` is drawn there (see
 * `target`).
 *
 * It renders nothing when:
 * - the message is not a generative UI activity;
 * - its content is malformed (in development it warns with the issues);
 * - there is no `<GenerativeUIProvider>` above it, or the provider has no
 *   `ui` (in development it warns);
 * - the agent is undefined or has no `threadId` yet, since the surface
 *   belongs to a thread (in development it warns);
 * - the surface's target is not `target`;
 * - the agent deleted the surface (`deleteSurface`).
 *
 * When the agent's `createSurface` was rejected, the Wrapper renders with
 * `children` set to `null`, and only the error shows.
 *
 * Each instance warns once for each distinct problem, also when a problem
 * goes away and comes back. A `message` with another id warns again.
 *
 * The provider ingests every activity message of `agent.messages` itself,
 * with the same checks: a malformed one is skipped there too (in
 * development it warns), so it cannot break the agent's run.
 *
 * @example
 * ```tsx
 * const { agent } = useAgent({ agentId: "home" });
 * return agent.messages
 *   .filter(isGenerativeUIActivity)
 *   .map((message) => (
 *     <GenerativeUIActivity key={message.id} message={message} agent={agent} />
 *   ));
 * ```
 *
 * Render every activity message, not only the latest: the latest can be a
 * surface of a named target, or a deleted surface, and render nothing. For a
 * placeholder until the agent renders, use `<GenerativeUISurface id
 * fallback>`, which knows whether its target has a surface.
 */
export function GenerativeUIActivity({
  message,
  agent,
  Wrapper = DefaultGenerativeUIActivityWrapper,
  target = GENERATIVE_UI_CHAT_TARGET,
}: GenerativeUIActivityProps) {
  const runtime = useGenerativeUIRuntime();
  const hasProvider = useContext(GenerativeUIProviderPresentContext);
  const isSurface = isGenerativeUIActivity(message);
  const rawContent = isSurface ? message.content : undefined;
  const parsed = useMemo(
    () => (isSurface ? parseGenerativeUISurfaceContent(rawContent) : undefined),
    [isSurface, rawContent],
  );
  const content = parsed?.content;
  const threadId = agent?.threadId;
  const agentId = agent?.agentId;
  let problem: string | undefined;
  if (isSurface) {
    if (!runtime) {
      problem = hasProvider
        ? "the <GenerativeUIProvider> above it has no `ui`."
        : "there is no <GenerativeUIProvider> above it.";
    } else if (parsed?.issues) {
      problem = `the content of activity message ${JSON.stringify(message.id ?? "")} is malformed: ${parsed.issues.join("; ")}.`;
    } else if (!agent) {
      problem = "the agent is undefined.";
    } else if (!threadId) {
      problem = "the agent has no threadId yet.";
    }
  }
  useDevelopmentWarnings(
    [
      problem === undefined
        ? undefined
        : `[generativeUI] <GenerativeUIActivity> renders nothing: ${problem}`,
    ],
    message.id,
  );
  // The provider ingests the messages of every agent it watches as well.
  // Ingesting here too covers an agent the provider has not seen yet.
  const { surface, rejected, error } = useGenerativeUIActivitySurface({
    runtime,
    threadId,
    agentId,
    content,
    target,
  });

  if (!content || !surface) return null;
  return (
    <Wrapper
      surfaceId={content.surfaceId}
      isStreaming={content.status === "streaming"}
      error={error}
      rejected={rejected}
    >
      {surface.failed ? null : <SurfaceView surface={surface} />}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  wrapper: { flexGrow: 1 },
  error: { marginTop: 8, fontSize: 12, color: "#dc2626" },
});
