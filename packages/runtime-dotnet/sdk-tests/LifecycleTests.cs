using System.Net;
using System.Text.Json.Nodes;
using CopilotKit.Intelligence;

internal static class LifecycleTests
{
    internal static async Task RunAsync()
    {
        await NotifiesMutations();
        await IsolatesListeners();
        await ResolvesCreation();
        await IgnoresFailedAndUnrelatedCalls();
        await SupportsConcurrentSubscriptions();
    }

    private static async Task NotifiesMutations()
    {
        using var handler = new CaptureHandler();
        using var http = new HttpClient(handler);
        using var sdk = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);
        var created = new List<ThreadEventArgs>();
        var updated = new List<ThreadEventArgs>();
        var deleted = new List<ThreadDeletedEventArgs>();
        object? sender = null;
        EventHandler<ThreadEventArgs> onCreated = (source, args) => { sender = source; created.Add(args); };
        sdk.ThreadCreated += onCreated;
        sdk.ThreadUpdated += (_, args) => updated.Add(args);
        sdk.ThreadDeleted += (_, args) => deleted.Add(args);

        var thread = await sdk.CreateThreadAsync("input", "user", "agent", learningContainerId: "existing-container");
        await sdk.UpdateThreadAsync("input", "user", "agent", new JsonObject { ["name"] = "new", ["userId"] = "untrusted" });
        await sdk.ArchiveThreadAsync("input", "user", "agent");
        await sdk.DeleteThreadAsync("thread/slash", "user", "agent");
        sdk.ThreadCreated -= onCreated;
        await sdk.CreateThreadAsync("second", "user", "agent");

        Check(created.Count == 1 && ReferenceEquals(sender, sdk), "creation notifies once with the SDK as sender and supports removal");
        Check(ReferenceEquals(created[0].Thread, thread) && thread.Id == "canonical", "creation returns the canonical event thread");
        Check(updated.Count == 2 && updated.All(args => args.Thread.ExtensionData["extension"].GetProperty("preserved").GetBoolean()), "update and archive emit canonical platform fields");
        Check(deleted.Count == 1 && deleted[0].ThreadId == "thread/slash" && deleted[0].UserId == "user" && deleted[0].AgentId == "agent", "deletion emits decoded thread ID and caller scope");
        Check(JsonNode.Parse(handler.Requests[0].Body!)!["learningContainerId"]!.GetValue<string>() == "existing-container", "creation assigns an existing Learning Container");
        Check(JsonNode.Parse(handler.Requests[1].Body!)!["userId"]!.GetValue<string>() == "user", "updates retain explicit user identity");
    }

    private static async Task IsolatesListeners()
    {
        using var http = new HttpClient(new CaptureHandler());
        using var sdk = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);
        var calls = new List<string>();
        EventHandler<ThreadEventArgs>? self = null;
        self = (_, _) => { calls.Add("self"); sdk.ThreadCreated -= self; };
        sdk.ThreadCreated += (_, _) => throw new InvalidOperationException("private callback key and thread");
        sdk.ThreadCreated += self;
        EventHandler<ThreadEventArgs> repeated = (_, _) => calls.Add("last");
        sdk.ThreadCreated += repeated;
        sdk.ThreadCreated += repeated;
        using var output = new StringWriter();
        using var trace = new System.Diagnostics.TextWriterTraceListener(output);
        System.Diagnostics.Trace.Listeners.Add(trace);
        try
        {
            await sdk.CreateThreadAsync("first", "user", "agent");
            sdk.ThreadCreated -= repeated;
            await sdk.CreateThreadAsync("second", "user", "agent");
            System.Diagnostics.Trace.Flush();
            Check(calls.SequenceEqual(new[] { "self", "last", "last", "last" }), "handler failures are isolated and native event removal preserves other registrations");
            Check(output.ToString().Contains("ThreadCreated") && output.ToString().Contains("InvalidOperationException")
                && !output.ToString().Contains("private callback"), "callback diagnostics name the event and exception type without private content");
        }
        finally { System.Diagnostics.Trace.Listeners.Remove(trace); }
    }

    private static async Task ResolvesCreation()
    {
        foreach (var mode in new[] { "existing", "created", "conflict" })
        {
            using var handler = new CaptureHandler();
            if (mode != "existing") handler.Responses.Enqueue((HttpStatusCode.NotFound, "{}"));
            if (mode == "conflict") handler.Responses.Enqueue((HttpStatusCode.Conflict, "{}"));
            using var http = new HttpClient(handler);
            using var sdk = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);
            var count = 0;
            sdk.ThreadCreated += (_, _) => count++;

            var resolution = await sdk.GetOrCreateThreadAsync("thread", "user", "agent");

            Check(count == (mode == "created" ? 1 : 0) && resolution.Created == (mode == "created"), "get-or-create notifies only for its own successful creation: " + mode);
        }
    }

    private static async Task IgnoresFailedAndUnrelatedCalls()
    {
        using var handler = new CaptureHandler();
        using var http = new HttpClient(handler);
        using var sdk = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);
        var count = 0;
        sdk.ThreadCreated += (_, _) => count++;
        sdk.ThreadUpdated += (_, _) => count++;
        sdk.ThreadDeleted += (_, _) => count++;
        foreach (var action in new Func<Task>[]
        {
            () => sdk.CreateThreadAsync("thread", "user", "agent"),
            () => sdk.UpdateThreadAsync("thread", "user", "agent", new JsonObject()),
            () => sdk.ArchiveThreadAsync("thread", "user", "agent"),
            () => sdk.DeleteThreadAsync("thread", "user", "agent")
        })
        {
            handler.Responses.Enqueue((HttpStatusCode.Forbidden, "private"));
            try { await action(); throw new Exception("denied write was accepted"); }
            catch (IntelligenceException error) when (error.StatusCode == 403) { }
        }
        foreach (var response in new[] { "", "not-json", "[]", "{\"thread\":{}}", "{\"thread\":{\"id\":2}}" })
        {
            handler.Responses.Enqueue((HttpStatusCode.OK, response));
            try { await sdk.CreateThreadAsync("thread", "user", "agent"); throw new Exception("malformed write response was accepted"); }
            catch (IntelligenceException error) when (error.StatusCode == 502) { }
        }
        await sdk.GetThreadAsync("thread", "user");
        handler.Responses.Enqueue((HttpStatusCode.OK, "{\"threads\":[],\"joinCode\":\"join\"}"));
        await sdk.ListThreadsAsync("user", "agent");
        const string memory = "{\"id\":\"memory\",\"kind\":\"fact\",\"scope\":\"user\",\"content\":\"content\",\"sourceThreadIds\":[],\"invalidatedAt\":null}";
        handler.Responses.Enqueue((HttpStatusCode.OK, memory));
        await sdk.CreateMemoryAsync("user", "content", "fact");
        handler.Responses.Enqueue((HttpStatusCode.OK, memory));
        await sdk.UpdateMemoryAsync("memory", "user", "content", "fact");
        await sdk.RemoveMemoryAsync("memory", "user");
        handler.Responses.Enqueue((HttpStatusCode.OK, "{\"id\":\"annotation\",\"duplicate\":false}"));
        await sdk.AnnotateAsync("user", "thread", "feedback");

        Check(count == 0, "denied or malformed writes, reads, Memory, and annotations emit no thread lifecycle events");
    }

    private static async Task SupportsConcurrentSubscriptions()
    {
        using var http = new HttpClient(new ConcurrentHandler());
        using var sdk = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);
        var notifications = 0;
        sdk.ThreadCreated += (_, _) => Interlocked.Increment(ref notifications);
        using var ready = new CountdownEvent(8);
        var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var work = Enumerable.Range(0, 8).Select(index => Task.Run(async () =>
        {
            EventHandler<ThreadEventArgs> temporary = (_, _) => { };
            ready.Signal();
            await start.Task;
            for (var iteration = 0; iteration < 20; iteration++)
            {
                sdk.ThreadCreated += temporary;
                await sdk.CreateThreadAsync($"{index}-{iteration}", "user", "agent");
                sdk.ThreadCreated -= temporary;
            }
        })).ToArray();
        Check(ready.Wait(TimeSpan.FromSeconds(5)), "concurrent lifecycle workers started");
        start.SetResult();
        await Task.WhenAll(work).WaitAsync(TimeSpan.FromSeconds(10));

        Check(notifications == 160, "concurrent subscriptions retain the persistent handler for every completed mutation");
    }

    private sealed class ConcurrentHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"thread\":{\"id\":\"thread\"}}") });
    }

    private static void Check(bool condition, string name)
    {
        if (!condition) throw new Exception(name);
        Console.WriteLine("PASS " + name);
    }
}
