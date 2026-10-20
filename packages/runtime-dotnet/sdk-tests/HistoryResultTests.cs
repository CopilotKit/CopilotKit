using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using CopilotKit.Intelligence;

internal static class HistoryResultTests
{
    internal static async Task RunAsync()
    {
        var untyped = new[] { "GetThreadMessagesAsync", "GetThreadEventsAsync", "GetThreadStateAsync", "AnnotateAsync" }
            .Where(name => typeof(IntelligenceClient).GetMethod(name)!.ReturnType.GenericTypeArguments.Single() == typeof(JsonObject));
        if (untyped.Any()) throw new Exception("Missing native resource types: " + string.Join(", ", untyped));
        var failures = new List<Exception>();
        foreach (var test in new Func<Task>[] { RoundTripsHistory, ReadsStateVariants, RejectsInvalidResults })
        {
            try { await test(); }
            catch (Exception error) { failures.Add(error); }
        }
        if (failures.Count > 0) throw new AggregateException(failures);
    }

    private static async Task RoundTripsHistory()
    {
        const string messages = """
            {"messages":[
              {"id":"a2ui","role":"activity","activityType":"a2ui-surface","content":{"surfaceId":"s1","nested":[null,true]},"extension":9223372036854775807},
              {"id":"call","role":"assistant","toolCalls":[{"id":"tc1","name":"scene","args":"{}","extension":true}]},
              {"id":"result","role":"tool","toolCallId":"tc1","content":null}],"extension":{"kept":true}}
            """;
        const string events = """
            {"events":[{"type":"CUSTOM","name":"mcp-app","value":{"resourceUri":"ui://scene"}}],"decodeErrorRowIds":["row-1"],"truncated":true,"extension":null}
            """;
        const string annotation = """{"id":"9223372036854775807","duplicate":true,"extension":[null,1]}""";
        using var handler = new CaptureHandler();
        foreach (var json in new[] { messages, events, annotation }) handler.Responses.Enqueue((HttpStatusCode.OK, json));
        using var http = new HttpClient(handler);
        using var client = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);

        ThreadMessagesResponse history = await client.GetThreadMessagesAsync("thread", "user");
        ThreadEventsResponse inspected = await client.GetThreadEventsAsync("thread");
        AnnotateResponse written = await client.AnnotateAsync("user", "thread", "feedback");

        Check(history.Messages[0].ActivityType == "a2ui-surface"
            && history.Messages[0].Content.GetProperty("surfaceId").GetString() == "s1"
            && history.Messages[0].ExtensionData["extension"].GetInt64() == long.MaxValue,
            "structured A2UI content and large extension values remain intact");
        Check(history.Messages[1].Content.ValueKind == JsonValueKind.Undefined
            && history.Messages[2].Content.ValueKind == JsonValueKind.Null
            && history.Messages[1].ToolCalls![0].Args == "{}" && history.Messages[2].ToolCallId == "tc1",
            "absent content, explicit null, and tool calls remain distinct");
        Check(inspected.Events[0].Type == "CUSTOM"
            && inspected.Events[0].ExtensionData["value"].GetProperty("resourceUri").GetString() == "ui://scene"
            && inspected.DecodeErrorRowIds.Single() == "row-1" && inspected.Truncated,
            "custom events and history status fields remain intact");
        Check(written.Id == "9223372036854775807" && written.Duplicate, "annotation IDs remain strings");
        Check(JsonNode.DeepEquals(JsonSerializer.SerializeToNode(history), JsonNode.Parse(messages))
            && JsonNode.DeepEquals(JsonSerializer.SerializeToNode(inspected), JsonNode.Parse(events))
            && JsonNode.DeepEquals(JsonSerializer.SerializeToNode(written), JsonNode.Parse(annotation)),
            "native history and annotation records round trip their JSON values");
    }

    private static async Task ReadsStateVariants()
    {
        foreach (var json in new[] {
            """{"extension":true,"kind":"no-snapshot"}""",
            """{"kind":"snapshot-decode-error","extension":null}""",
            """{"state":[null,{"count":1}],"skippedDeltas":2,"kind":"snapshot","extension":"kept"}""",
            """{"kind":"snapshot","state":null,"skippedDeltas":0}""" })
        {
            using var handler = new CaptureHandler { ResponseBody = json };
            using var http = new HttpClient(handler);
            using var client = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);

            ThreadStateResponse result = await client.GetThreadStateAsync("thread");
            var expected = JsonNode.Parse(json)!;

            Check(expected["kind"]!.GetValue<string>() switch
            {
                "no-snapshot" => result is ThreadNoSnapshot,
                "snapshot-decode-error" => result is ThreadSnapshotDecodeError,
                _ => result is ThreadSnapshot snapshot && snapshot.SkippedDeltas == expected["skippedDeltas"]!.GetValue<int>()
            }, "state result supports native pattern matching");
            Check(JsonNode.DeepEquals(JsonSerializer.SerializeToNode(result), expected), "state variants round trip regardless of property order");
        }
    }

    private static async Task RejectsInvalidResults()
    {
        var failures = new List<string>();
        var cases = new (string Json, Func<IntelligenceClient, Task> Call)[]
        {
            ("{\"messages\":[null]}", client => client.GetThreadMessagesAsync("thread", "user")),
            ("{\"messages\":[{\"id\":\"m\",\"role\":\"assistant\",\"toolCalls\":[null]}]}", client => client.GetThreadMessagesAsync("thread", "user")),
            ("{\"events\":[null],\"decodeErrorRowIds\":[],\"truncated\":false}", client => client.GetThreadEventsAsync("thread")),
            ("{\"events\":[],\"decodeErrorRowIds\":[null],\"truncated\":false}", client => client.GetThreadEventsAsync("thread")),
            ("{}", client => client.GetThreadStateAsync("thread")),
            ("{\"kind\":\"PRIVATE_KIND\"}", client => client.GetThreadStateAsync("thread")),
            ("{\"kind\":\"snapshot\",\"skippedDeltas\":0}", client => client.GetThreadStateAsync("thread")),
            ("{\"id\":1,\"duplicate\":true}", client => client.AnnotateAsync("user", "thread", "feedback")),
            ("{\"id\":\"PRIVATE_ID\"}", client => client.AnnotateAsync("user", "thread", "feedback"))
        };
        foreach (var item in cases)
        {
            using var handler = new CaptureHandler { ResponseBody = item.Json };
            using var http = new HttpClient(handler);
            using var client = new IntelligenceClient(new IntelligenceOptions { ApiKey = "key" }, http);
            try { await item.Call(client); failures.Add("accepted " + item.Json); }
            catch (IntelligenceException error) when (error.StatusCode == 502 && error.InnerException is null && !error.ToString().Contains("PRIVATE")) { }
            catch (Exception error) { failures.Add("unsafe error: " + error.GetType().Name); }
        }
        Check(failures.Count == 0, "invalid history/state/annotation results return safe 502: " + string.Join(", ", failures));
    }

    private static void Check(bool condition, string name)
    {
        if (!condition) throw new Exception(name);
        Console.WriteLine("PASS " + name);
    }
}
