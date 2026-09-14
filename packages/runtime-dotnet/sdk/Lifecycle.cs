using System.Text.Json.Nodes;

namespace CopilotKit.Intelligence;

/// <summary>The canonical thread returned after a successful mutation.</summary>
public sealed class ThreadEventArgs(ThreadSummary thread) : EventArgs
{
    /// <summary>The thread, including platform extension fields.</summary>
    public ThreadSummary Thread { get; } = thread;
}

/// <summary>The thread identifier and caller scope of a successful deletion.</summary>
public sealed class ThreadDeletedEventArgs(string threadId, string userId, string agentId) : EventArgs
{
    /// <summary>The deleted thread identifier.</summary>
    public string ThreadId { get; } = threadId;
    /// <summary>The application user that requested deletion.</summary>
    public string UserId { get; } = userId;
    /// <summary>The agent that requested deletion.</summary>
    public string AgentId { get; } = agentId;
}

public sealed partial class IntelligenceClient
{
    /// <summary>Occurs after this client creates a thread.</summary>
    public event EventHandler<ThreadEventArgs>? ThreadCreated;
    /// <summary>Occurs after this client updates or archives a thread.</summary>
    public event EventHandler<ThreadEventArgs>? ThreadUpdated;
    /// <summary>Occurs after this client deletes a thread.</summary>
    public event EventHandler<ThreadDeletedEventArgs>? ThreadDeleted;

    private ThreadSummary? NotifyThreadMutation(HttpMethod method, string path, JsonNode? body, JsonNode? result)
    {
        var resource = path.Split('?', 2)[0];
        const string prefix = "/api/threads/";
        var threadId = resource.StartsWith(prefix, StringComparison.Ordinal) ? resource[prefix.Length..] : "";
        var isThread = threadId.Length > 0 && !threadId.Contains('/');
        if (method == HttpMethod.Post && resource == "/api/threads" || method == HttpMethod.Patch && isThread)
        {
            ThreadSummary thread;
            try { thread = Thread(result); }
            catch (IntelligenceException) { return null; }
            if (method == HttpMethod.Post) Notify(ThreadCreated, new ThreadEventArgs(thread), nameof(ThreadCreated));
            else Notify(ThreadUpdated, new ThreadEventArgs(thread), nameof(ThreadUpdated));
            return thread;
        }
        else if (method == HttpMethod.Delete && isThread && body is JsonObject request
            && request["userId"] is JsonValue user && user.TryGetValue<string>(out var userId)
            && request["agentId"] is JsonValue agent && agent.TryGetValue<string>(out var agentId))
        {
            Notify(ThreadDeleted, new ThreadDeletedEventArgs(Uri.UnescapeDataString(threadId), userId, agentId), nameof(ThreadDeleted));
        }
        return null;
    }

    private void Notify<T>(EventHandler<T>? handlers, T args, string operation) where T : EventArgs
    {
        if (handlers is null) return;
        foreach (EventHandler<T> handler in handlers.GetInvocationList())
        {
            try { handler(this, args); }
            catch (Exception error)
            {
                // A callback cannot undo a platform write. Do not log its message or payload.
                try { System.Diagnostics.Trace.TraceWarning("Intelligence {0} handler failed ({1})", operation, error.GetType().Name); }
                catch (Exception) { /* A diagnostic listener cannot change the completed mutation. */ }
            }
        }
    }
}
