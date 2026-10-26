using System.Collections;
using System.Runtime.CompilerServices;
using System.Text.Json;
using AGUI.Abstractions;
using AGUI.Server;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;

var failures = new List<string>();
var cases = new List<(string Name, Func<Task> Run)>();

foreach (string? state in new string?[] { null, "null", "true", "7", "\"hello\"", "[]", "{}", "{\"unrelated\":true}", "{\"proverbs\":null}", "{\"proverbs\":[1]}", "{\"proverbs\":{}}" })
{
    cases.Add(($"ordinary chat with {state ?? "absent"} state", async () =>
    {
        var fake = new ScriptedAgent(_ => [Text("The answer is 4.")]);
        var options = Options(state);
        var session = await fake.CreateSessionAsync();
        using var cancellation = new CancellationTokenSource();
        var messages = new[] { new ChatMessage(ChatRole.User, "What is 2 + 2?") };
        var output = await Drain(new SharedStateAgent(fake, JsonSerializerOptions.Web, UnexpectedChatClientConstruction), messages, session, options, cancellation.Token);
        Equal("The answer is 4.", Prose(output));
        Equal(1, fake.Calls.Count);
        Equal(0, Data(output).Count);
        Same(options, fake.Calls[0].Options);
        Same(session, fake.Calls[0].Session);
        Equal(cancellation.Token, fake.Calls[0].CancellationToken);
        Equal(1, fake.Calls[0].Messages.Count);
        Equal(ChatResponseFormat.Text, options.ChatOptions!.ResponseFormat);
    }));
}

foreach (string state in new[] { "{\"proverbs\":[]}", "{\"proverbs\":[\"A stitch in time saves nine.\"]}" })
{
    foreach (var (question, answer) in new[] { ("What is 2 + 2?", "4"), ("What is the capital of France?", "Paris") })
    {
        cases.Add(($"recognized state answers {question} ({state})", async () =>
        {
            var fake = new ScriptedAgent(call => call.Number == 1 ? [Text(state)] : [Text(Answer(call, question, answer))]);
            var options = Options(state);
            var output = await Drain(new SharedStateAgent(fake, JsonSerializerOptions.Web, UnexpectedChatClientConstruction), [new(ChatRole.User, question)], null, options);
            Equal(answer, Prose(output));
            Equal(2, fake.Calls.Count);
            Equal(1, Data(output).Count);
            Equal(state, Data(output)[0].GetRawText());
            True(fake.Calls[1].Messages.Any(m => m.Role == ChatRole.User && m.Text == question), "Second call lost the original question");
            True(fake.Calls[0].Options is ChatClientAgentRunOptions { ChatOptions.ResponseFormat: ChatResponseFormatJson }, "State pass did not request a schema");
            AssertReadOnlyAnswerOptions(options, fake.Calls[1].Options);
            Equal(ChatResponseFormat.Text, options.ChatOptions!.ResponseFormat);
        }));
    }
}

cases.Add(("state edits preserve unrelated fields and answer once with one-use messages", async () =>
{
    const string snapshot = "{\"proverbs\":[\"Measure twice, cut once.\"]}";
    const string question = "Add Measure twice, cut once.";
    var fake = new ScriptedAgent(call => call.Number == 1 ? [Text(snapshot)] : [Text(Answer(call, question, "Added Measure twice, cut once."))]);
    var options = Options("{\"proverbs\":[],\"theme\":\"dark\"}");
    var session = await fake.CreateSessionAsync();
    using var cancellation = new CancellationTokenSource();
    var output = await Drain(new SharedStateAgent(fake, JsonSerializerOptions.Web, UnexpectedChatClientConstruction), new OnceMessages([new(ChatRole.User, question)]), session, options, cancellation.Token);
    Equal("Added Measure twice, cut once.", Prose(output));
    Equal(2, fake.Calls.Count);
    var state = Data(output).Single();
    Equal("Measure twice, cut once.", state.GetProperty("proverbs")[0].GetString());
    Equal("dark", state.GetProperty("theme").GetString());
    foreach (var call in fake.Calls)
    {
        Same(session, call.Session);
        Equal(cancellation.Token, call.CancellationToken);
    }
}));

foreach (string response in new[] { "The answer is 4.", "{broken", "null", "42", "\"answer\"", "[]", "{}", "{\"unrelated\":true}", "{\"proverbs\":null}", "{\"proverbs\":[1]}" })
{
    cases.Add(($"invalid snapshot replays exact withheld text and tool once: {response}", async () =>
    {
        var tool = new AgentResponseUpdate(ChatRole.Assistant, [new FunctionCallContent("call-1", "get_proverbs")]);
        var pieces = new[] { Text(response[..(response.Length / 2)]), tool, Text(response[(response.Length / 2)..]) };
        var fake = new ScriptedAgent(_ => pieces);
        var output = await Drain(new SharedStateAgent(fake, JsonSerializerOptions.Web, UnexpectedChatClientConstruction), [new(ChatRole.User, "What is 2 + 2?")], null, Options("{\"proverbs\":[]}"));
        Equal(response, Prose(output));
        Equal(1, fake.Calls.Count);
        Equal(0, Data(output).Count);
        Equal(1, output.Count(u => ReferenceEquals(u, tool)));
        Equal(1, output.Count(u => ReferenceEquals(u, pieces[0])));
        Equal(1, output.Count(u => ReferenceEquals(u, pieces[2])));
    }));
}

cases.Add(("valid snapshot forwards tools once and withholds JSON", async () =>
{
    var tool = new AgentResponseUpdate(ChatRole.Assistant, [new FunctionCallContent("call-1", "get_proverbs")]);
    var fake = new ScriptedAgent(call => call.Number == 1 ? [tool, Text("{\"proverbs\":[]}")] : [Text("4")]);
    var output = await Drain(new SharedStateAgent(fake, JsonSerializerOptions.Web, UnexpectedChatClientConstruction), [new(ChatRole.User, "What is 2 + 2?")], null, Options("{\"proverbs\":[]}"));
    Equal("4", Prose(output));
    Equal(1, output.Count(u => ReferenceEquals(u, tool)));
    Equal(1, Data(output).Count);
}));

cases.Add(("cancellation reaches the structured stream", async () =>
{
    using var cancellation = new CancellationTokenSource();
    var fake = new ScriptedAgent(_ => { cancellation.Cancel(); return [Text("{\"proverbs\":[]}")]; });
    try
    {
        await Drain(new SharedStateAgent(fake, JsonSerializerOptions.Web, UnexpectedChatClientConstruction), [new(ChatRole.User, "Hello")], null, Options("{\"proverbs\":[]}"), cancellation.Token);
        throw new Exception("Expected cancellation");
    }
    catch (OperationCanceledException)
    {
        Equal(cancellation.Token, fake.Calls.Single().CancellationToken);
    }
}));

cases.Add(("public non-streaming RunAsync drains the same wrapper", async () =>
{
    var fake = new ScriptedAgent(call => call.Number == 1 ? [Text("{\"proverbs\":[]}")] : [Text(Answer(call, "What is 2 + 2?", "4"))]);
    var response = await new SharedStateAgent(fake, JsonSerializerOptions.Web, UnexpectedChatClientConstruction).RunAsync([new ChatMessage(ChatRole.User, "What is 2 + 2?")], options: Options("{\"proverbs\":[]}"));
    Equal("4", response.Text);
    Equal(1, response.Messages.SelectMany(m => m.Contents).OfType<DataContent>().Count());
    Equal(2, fake.Calls.Count);
}));

foreach (string? state in new string?[] { null, "null", "true", "7", "\"hello\"", "[]", "{}", "{\"unrelated\":true}", "{\"proverbs\":null}", "{\"proverbs\":[1]}", "{\"proverbs\":{}}" })
{
    cases.Add(($"ordinary chat one-use messages with {state ?? "absent"} state", async () =>
    {
        var fake = new ScriptedAgent(_ => [Text("The answer is 4.")]);
        var options = Options(state);
        var session = await fake.CreateSessionAsync();
        using var cancellation = new CancellationTokenSource();
        var output = await Drain(new SharedStateAgent(fake, JsonSerializerOptions.Web, UnexpectedChatClientConstruction), new OnceMessages([new ChatMessage(ChatRole.User, "What is 2 + 2?")]), session, options, cancellation.Token);
        Equal("The answer is 4.", Prose(output));
        Equal(1, fake.Calls.Count);
        Equal(0, Data(output).Count);
        Same(options, fake.Calls[0].Options);
        Same(session, fake.Calls[0].Session);
        Equal(cancellation.Token, fake.Calls[0].CancellationToken);
        Equal(1, fake.Calls[0].Messages.Count);
        Equal(ChatRole.User, fake.Calls[0].Messages[0].Role);
        Equal("What is 2 + 2?", fake.Calls[0].Messages[0].Text);
        Equal(ChatResponseFormat.Text, options.ChatOptions!.ResponseFormat);
    }));
}

cases.Add(("valid mixed snapshot withholds JSON and preserves tool metadata", async () =>
{
    const string snapshot = "{\"proverbs\":[]}";
    var text = new TextContent(snapshot);
    var tool = new FunctionCallContent("mixed-valid-call", "get_proverbs");
    var contents = new List<AIContent> { text, tool };
    var raw = new object();
    var properties = new AdditionalPropertiesDictionary { ["mixed-kind"] = "valid" };
    var mixed = new AgentResponseUpdate(ChatRole.Assistant, contents)
    {
        AuthorName = "mixed-valid-author",
        AgentId = "mixed-valid-agent",
        ResponseId = "mixed-valid-response",
        MessageId = "mixed-valid-message",
        CreatedAt = new DateTimeOffset(2026, 10, 25, 1, 2, 3, TimeSpan.Zero),
        FinishReason = ChatFinishReason.ToolCalls,
        RawRepresentation = raw,
        AdditionalProperties = properties
    };
    var fake = new ScriptedAgent(call => call.Number == 1 ? [mixed] : [Text("4")]);
    var output = await Drain(new SharedStateAgent(fake, JsonSerializerOptions.Web, UnexpectedChatClientConstruction), [new(ChatRole.User, "What is 2 + 2?")], null, Options(snapshot));
    Equal("4", Prose(output));
    Equal(2, fake.Calls.Count);
    Equal(1, Data(output).Count);
    Equal(snapshot, Data(output)[0].GetRawText());
    Equal(1, output.SelectMany(u => u.Contents).Count(c => ReferenceEquals(c, tool)));
    var toolUpdate = output.Single(u => u.Contents.Any(c => ReferenceEquals(c, tool)));
    Equal(1, toolUpdate.Contents.Count);
    Same(tool, toolUpdate.Contents[0]);
    Equal(mixed.Role, toolUpdate.Role);
    Equal(mixed.AuthorName, toolUpdate.AuthorName);
    Equal(mixed.AgentId, toolUpdate.AgentId);
    Equal(mixed.ResponseId, toolUpdate.ResponseId);
    Equal(mixed.MessageId, toolUpdate.MessageId);
    Equal(mixed.CreatedAt, toolUpdate.CreatedAt);
    Equal(mixed.FinishReason, toolUpdate.FinishReason);
    Same(raw, toolUpdate.RawRepresentation);
    Same(properties, toolUpdate.AdditionalProperties);
    Same(contents, mixed.Contents);
    Equal(2, mixed.Contents.Count);
    Same(text, mixed.Contents[0]);
    Same(tool, mixed.Contents[1]);
    Equal(snapshot, text.Text);
}));

cases.Add(("invalid mixed snapshot replays ABC once and preserves projected metadata", async () =>
{
    var before = Text("A");
    var text = new TextContent("B");
    var tool = new FunctionCallContent("mixed-invalid-call", "get_proverbs");
    var contents = new List<AIContent> { text, tool };
    var raw = new object();
    var properties = new AdditionalPropertiesDictionary { ["mixed-kind"] = "invalid" };
    var mixed = new AgentResponseUpdate(ChatRole.Assistant, contents)
    {
        AuthorName = "mixed-invalid-author",
        AgentId = "mixed-invalid-agent",
        ResponseId = "mixed-invalid-response",
        MessageId = "mixed-invalid-message",
        CreatedAt = new DateTimeOffset(2026, 10, 25, 4, 5, 6, TimeSpan.Zero),
        FinishReason = ChatFinishReason.ToolCalls,
        RawRepresentation = raw,
        AdditionalProperties = properties
    };
    var after = Text("C");
    var fake = new ScriptedAgent(_ => [before, mixed, after]);
    var output = await Drain(new SharedStateAgent(fake, JsonSerializerOptions.Web, UnexpectedChatClientConstruction), [new(ChatRole.User, "What is 2 + 2?")], null, Options("{\"proverbs\":[]}"));
    Equal("ABC", Prose(output));
    Equal(1, fake.Calls.Count);
    Equal(0, Data(output).Count);
    Equal(1, output.SelectMany(u => u.Contents).Count(c => ReferenceEquals(c, tool)));
    foreach (string piece in new[] { "A", "B", "C" })
    {
        Equal(1, output.SelectMany(u => u.Contents).OfType<TextContent>().Count(c => c.Text == piece));
    }
    Equal(1, output.Count(u => ReferenceEquals(u, before)));
    Equal(1, output.Count(u => ReferenceEquals(u, after)));
    var textUpdate = output.Single(u => u.Contents.Any(c => ReferenceEquals(c, text)));
    var toolUpdate = output.Single(u => u.Contents.Any(c => ReferenceEquals(c, tool)));
    Equal(1, textUpdate.Contents.Count);
    Same(text, textUpdate.Contents[0]);
    Equal(1, toolUpdate.Contents.Count);
    Same(tool, toolUpdate.Contents[0]);
    foreach (var projected in new[] { textUpdate, toolUpdate })
    {
        Equal(mixed.Role, projected.Role);
        Equal(mixed.AuthorName, projected.AuthorName);
        Equal(mixed.AgentId, projected.AgentId);
        Equal(mixed.ResponseId, projected.ResponseId);
        Equal(mixed.MessageId, projected.MessageId);
        Equal(mixed.CreatedAt, projected.CreatedAt);
        Equal(mixed.FinishReason, projected.FinishReason);
        Same(raw, projected.RawRepresentation);
        Same(properties, projected.AdditionalProperties);
    }
    Same(contents, mixed.Contents);
    Equal(2, mixed.Contents.Count);
    Same(text, mixed.Contents[0]);
    Same(tool, mixed.Contents[1]);
    Equal("B", text.Text);
}));

foreach (var (placement, editInFirstPass) in new[]
{
    ("configured", true), ("configured", false), ("caller-factory", false), ("additional", false)
})
{
    cases.Add(($"answer pass cannot mutate after publication ({placement}, first edit {editInFirstPass})", async () =>
    {
        var proverbs = new List<string>();
        bool snapshotPublished = false;
        int mutationsAfterPublication = 0;
        int factoryCalls = 0;
        var mutator = AIFunctionFactory.Create((Action)(() =>
        {
            if (snapshotPublished) mutationsAfterPublication++;
            proverbs.Add("Measure twice, cut once.");
        }), options: new() { Name = "add_proverbs" });
        var provider = new MutationAttemptChatClient(mutator.Name, editInFirstPass, () => JsonSerializer.Serialize(new { proverbs }));
        IChatClient ConfigureClient(IChatClient leaf) => placement == "additional"
            ? new FunctionInvokingChatClient(leaf) { AdditionalTools = [mutator] }
            : leaf;
        var agentOptions = new ChatClientAgentOptions
        {
            ChatOptions = new ChatOptions { Tools = placement == "configured" ? [mutator] : [] }
        };
        var inner = new ChatClientAgent(ConfigureClient(provider), agentOptions);
        var options = Options("{\"proverbs\":[]}");
        var originalChatOptions = options.ChatOptions!;
        originalChatOptions.ToolMode = ChatToolMode.Auto;
        originalChatOptions.Temperature = 0.25f;
        originalChatOptions.AdditionalProperties!["f4-sentinel"] = "retained";
        Func<IChatClient, IChatClient> callerFactory = next =>
        {
            factoryCalls++;
            return placement == "caller-factory"
                ? new ConfigureOptionsChatClient(next, co =>
                {
                    co.Tools ??= [];
                    co.Tools.Add(mutator);
                })
                : next;
        };
        options.ChatClientFactory = callerFactory;
        var session = await inner.CreateSessionAsync();
        using var cancellation = new CancellationTokenSource();
        var output = new List<AgentResponseUpdate>();
        await foreach (var update in new SharedStateAgent(inner, JsonSerializerOptions.Web,
            decorate => new ChatClientAgent(ConfigureClient(decorate(provider)), agentOptions).ChatClient).RunStreamingAsync(
            [new ChatMessage(ChatRole.User, "Add Measure twice, cut once.")], session, options, cancellation.Token))
        {
            output.Add(update);
            if (update.Contents.OfType<DataContent>().Any()) snapshotPublished = true;
        }
        // Check the real side effect first: a clone/policy-only failure is not the
        // required behavioral RED for this case.
        Equal(0, mutationsAfterPublication);
        Equal(editInFirstPass ? 1 : 0, proverbs.Count);
        var published = Data(output).Single();
        Equal(proverbs.Count, published.GetProperty("proverbs").GetArrayLength());
        Equal("Done.", Prose(output));
        True(provider.AnswerAttempted, "Provider never attempted the forbidden answer-pass call");
        Equal(2, factoryCalls);
        True(provider.AnswerTools.All(tool => tool is not AIFunction), "Answer provider still received executable tools");
        True(provider.AnswerTools.Any(tool => tool.Name == mutator.Name), "Missing non-invocable shadow for the attempted function");
        Equal(ChatToolMode.None, provider.AnswerToolMode);
        True(provider.Tokens.All(token => token == cancellation.Token), "Cancellation token changed");
        True(provider.Sessions.All(observed => ReferenceEquals(observed, session)), "Session changed");
        Same(originalChatOptions, options.ChatOptions);
        Same(callerFactory, options.ChatClientFactory);
        Equal(ChatToolMode.Auto, originalChatOptions.ToolMode);
        Equal(0.25f, originalChatOptions.Temperature);
        Equal(ChatResponseFormat.Text, originalChatOptions.ResponseFormat);
        Equal("retained", originalChatOptions.AdditionalProperties!["f4-sentinel"]);
    }));
}

// Insert immediately before foreach (var test in cases). All existing 46 cases,
// existing MutationAttemptChatClient, helpers, and assertions stay unchanged.
foreach (string placement in new[] { "configured", "additional" })
{
    cases.Add(($"answer pass cannot mutate through factory invoker ({placement})", async () =>
    {
        var proverbs = new List<string>();
        bool snapshotPublished = false;
        int mutationsAfterPublication = 0;
        int factoryCalls = 0;
        int answerDecoratorCalls = 0;
        var mutator = AIFunctionFactory.Create((Action)(() =>
        {
            if (snapshotPublished) mutationsAfterPublication++;
            proverbs.Add("Measure twice, cut once.");
        }), options: new() { Name = "add_proverbs" });
        var provider = new MutationAttemptChatClient(mutator.Name, true,
            () => JsonSerializer.Serialize(new { proverbs }));
        // Both invokers are the actual SDK executor. TerminateOnUnknownCalls
        // lets calls for the outer invoker's AdditionalTools pass through the
        // inner invoker; no test-side execution policy or mutation guard exists.
        var configuredInvoker = new FunctionInvokingChatClient(provider)
        {
            TerminateOnUnknownCalls = true
        };
        var inner = new ChatClientAgent(configuredInvoker, new ChatClientAgentOptions
        {
            UseProvidedChatClientAsIs = true,
            ChatOptions = new ChatOptions { Tools = placement == "configured" ? [mutator] : [] }
        });
        var options = Options("{\"proverbs\":[]}");
        var originalChatOptions = options.ChatOptions!;
        originalChatOptions.ToolMode = ChatToolMode.Auto;
        originalChatOptions.Temperature = 0.25f;
        originalChatOptions.AdditionalProperties!["r3-sentinel"] = "retained";
        Func<IChatClient, IChatClient> callerFactory = next =>
        {
            factoryCalls++;
            var factoryInvoker = new FunctionInvokingChatClient(next)
            {
                AdditionalTools = placement == "additional" ? [mutator] : null
            };
            // Ordinary outer options middleware must remain active, and hides
            // the invoker behind another documented SDK decorator.
            return new ConfigureOptionsChatClient(factoryInvoker, _ =>
            {
                if (snapshotPublished) answerDecoratorCalls++;
            });
        };
        options.ChatClientFactory = callerFactory;
        var session = await inner.CreateSessionAsync();
        using var cancellation = new CancellationTokenSource();
        var output = new List<AgentResponseUpdate>();
        await foreach (var update in new SharedStateAgent(inner, JsonSerializerOptions.Web,
            decorate => new FunctionInvokingChatClient(decorate(provider)) { TerminateOnUnknownCalls = true }).RunStreamingAsync(
            [new ChatMessage(ChatRole.User, "Add Measure twice, cut once.")], session, options, cancellation.Token))
        {
            output.Add(update);
            if (update.Contents.OfType<DataContent>().Any()) snapshotPublished = true;
        }
        // The first assertion must expose actual execution, not policy identity.
        Equal(0, mutationsAfterPublication);
        Equal(1, proverbs.Count); // The first pass really invoked the mutator.
        Equal(1, Data(output).Single().GetProperty("proverbs").GetArrayLength());
        Equal("Done.", Prose(output));
        True(provider.AnswerAttempted, "Provider never attempted the answer-pass call");
        Equal(2, factoryCalls);
        True(answerDecoratorCalls > 0, "Caller decorator did not run during the answer pass");
        True(provider.AnswerTools.All(tool => tool is not AIFunction), "Executable answer tools reached provider");
        // AdditionalTools are execution-only SDK capabilities, not provider
        // declarations. This case deliberately does not require them advertised.
        if (placement == "configured")
            True(provider.AnswerTools.Any(tool => tool.Name == mutator.Name), "Configured declaration lost");
        Equal(ChatToolMode.None, provider.AnswerToolMode);
        True(provider.Tokens.All(token => token == cancellation.Token), "Cancellation token changed");
        True(provider.Sessions.All(observed => ReferenceEquals(observed, session)), "Session changed");
        Same(originalChatOptions, options.ChatOptions);
        Same(callerFactory, options.ChatClientFactory);
        Equal(ChatToolMode.Auto, originalChatOptions.ToolMode);
        Equal(0.25f, originalChatOptions.Temperature);
        Equal(ChatResponseFormat.Text, originalChatOptions.ResponseFormat);
        Equal("retained", originalChatOptions.AdditionalProperties!["r3-sentinel"]);
    }));
}

foreach (bool decorateRequest in new[] { false, true })
{
    cases.Add(($"answer pass cannot mutate through nested configured invokers (request decorator {decorateRequest})", async () =>
    {
        var proverbs = new List<string>();
        bool snapshotPublished = false;
        int mutationsAfterPublication = 0;
        int factoryCalls = 0;
        int answerDecoratorCalls = 0;
        AIFunction Mutator(string name) => AIFunctionFactory.Create((Action)(() =>
        {
            if (snapshotPublished) mutationsAfterPublication++;
            proverbs.Add(name);
        }), options: new() { Name = name });
        var outerMutator = Mutator("mutate_outer");
        var innerMutator = Mutator("mutate_inner");
        var provider = new NestedMutationAttemptChatClient([outerMutator.Name, innerMutator.Name],
            () => JsonSerializer.Serialize(new { proverbs }));
        var configuredInner = new FunctionInvokingChatClient(provider)
        {
            AdditionalTools = [innerMutator], TerminateOnUnknownCalls = true
        };
        var configuredOuter = new FunctionInvokingChatClient(configuredInner)
        {
            AdditionalTools = [outerMutator], TerminateOnUnknownCalls = true
        };
        var originalInnerTools = configuredInner.AdditionalTools;
        var originalOuterTools = configuredOuter.AdditionalTools;
        var agentChatOptions = new ChatOptions { Tools = [] };
        var inner = new ChatClientAgent(configuredOuter, new ChatClientAgentOptions
        {
            UseProvidedChatClientAsIs = true, ChatOptions = agentChatOptions
        });
        var options = Options("{\"proverbs\":[]}");
        var originalChatOptions = options.ChatOptions!;
        originalChatOptions.Tools = [];
        var originalTools = originalChatOptions.Tools;
        originalChatOptions.ToolMode = ChatToolMode.Auto;
        originalChatOptions.Temperature = 0.25f;
        originalChatOptions.AdditionalProperties!["r4-sentinel"] = "retained";
        Func<IChatClient, IChatClient>? callerFactory = decorateRequest ? next =>
        {
            factoryCalls++;
            return new ConfigureOptionsChatClient(next, co =>
            {
                if (snapshotPublished) answerDecoratorCalls++;
                co.AdditionalProperties ??= new();
                co.AdditionalProperties["r4-request-decorated"] = true;
            });
        } : null;
        options.ChatClientFactory = callerFactory;
        var session = await inner.CreateSessionAsync();
        using var cancellation = new CancellationTokenSource();
        var output = new List<AgentResponseUpdate>();
        await foreach (var update in new SharedStateAgent(inner, JsonSerializerOptions.Web,
            decorate => new FunctionInvokingChatClient(new FunctionInvokingChatClient(decorate(provider))
            {
                AdditionalTools = originalInnerTools, TerminateOnUnknownCalls = true
            })
            {
                AdditionalTools = originalOuterTools, TerminateOnUnknownCalls = true
            }).RunStreamingAsync(
            [new ChatMessage(ChatRole.User, "What is 2 + 2?")], session, options, cancellation.Token))
        {
            output.Add(update);
            if (update.Contents.OfType<DataContent>().Any()) snapshotPublished = true;
        }
        // Assert the real delegate's side effect before checking policy or
        // compatibility: a declaration-only mismatch is not the required RED.
        Equal(0, mutationsAfterPublication);
        Equal(0, proverbs.Count);
        Equal(JsonSerializer.Serialize(new { proverbs }), Data(output).Single().GetRawText());
        Equal("4", Prose(output));
        True(provider.AnswerAttempted, "Provider never attempted the answer-pass call");
        True(provider.AttemptedToolName == outerMutator.Name || provider.AttemptedToolName == innerMutator.Name,
            "Provider did not select a configured execution-only tool");
        True(provider.Tokens.Count is >= 2 and <= 8, "Unexpected provider call count");
        True(provider.AnswerTools.All(tool => tool is not AIFunction), "Executable answer tools reached provider");
        Equal(ChatToolMode.None, provider.AnswerToolMode);
        Equal(decorateRequest ? 2 : 0, factoryCalls);
        True(!decorateRequest || answerDecoratorCalls > 0, "Request decorator did not run during the answer pass");
        True(provider.RequestDecorations.All(decorated => decorated == decorateRequest), "Request decoration changed");
        True(provider.Tokens.All(token => token == cancellation.Token), "Cancellation token changed");
        True(provider.Sessions.All(observed => ReferenceEquals(observed, session)), "Session changed");
        Same(originalChatOptions, options.ChatOptions);
        Same(originalTools, originalChatOptions.Tools);
        Same(callerFactory, options.ChatClientFactory);
        Equal(0, originalTools.Count);
        Equal(0, agentChatOptions.Tools!.Count);
        Same(originalInnerTools, configuredInner.AdditionalTools);
        Same(originalOuterTools, configuredOuter.AdditionalTools);
        Same(innerMutator, configuredInner.AdditionalTools!.Single());
        Same(outerMutator, configuredOuter.AdditionalTools!.Single());
        Equal(ChatToolMode.Auto, originalChatOptions.ToolMode);
        Equal(0.25f, originalChatOptions.Temperature);
        Equal(ChatResponseFormat.Text, originalChatOptions.ResponseFormat);
        Equal("retained", originalChatOptions.AdditionalProperties!["r4-sentinel"]);
        True(!originalChatOptions.AdditionalProperties.ContainsKey("r4-request-decorated"), "Request decorator mutated caller options");
    }));
}

foreach (string exit in new[] { "complete", "early-break", "cancel", "provider-throw", "caller-throw", "caller-null", "builder-throw", "builder-null" })
{
    cases.Add(($"answer pipeline ownership survives {exit}", async () =>
    {
        using var cancellation = new CancellationTokenSource();
        var failure = new InvalidOperationException($"Expected {exit}");
        var provider = new LifetimeChatClient
        {
            Failure = exit == "provider-throw" ? failure : null,
            OnAnswer = exit == "cancel" ? cancellation.Cancel : null
        };
        var original = new DisposalTrackingChatClient(provider, () => provider.ActiveEnumerators > 0);
        var inner = new ChatClientAgent(original, new ChatClientAgentOptions { UseProvidedChatClientAsIs = true });
        var owned = new List<DisposalTrackingChatClient>();
        int factoryCalls = 0;
        var options = Options("{\"proverbs\":[]}");
        options.ChatClientFactory = next =>
        {
            if (++factoryCalls == 2)
            {
                if (exit == "caller-throw") throw failure;
                if (exit == "caller-null") return null!;
                // Accidental caller disposal must not pre-empt the local owner.
                next.Dispose();
                Equal(0, owned.Single().DisposeCount);
            }
            return next;
        };
        var wrapper = new SharedStateAgent(inner, JsonSerializerOptions.Web, decorate =>
        {
            if (exit == "builder-null") return null!;
            var pipeline = new DisposalTrackingChatClient(decorate(provider), () => provider.ActiveEnumerators > 0);
            owned.Add(pipeline);
            if (exit == "builder-throw")
            {
                // A builder retains ownership until it returns successfully.
                pipeline.Dispose();
                throw failure;
            }
            return pipeline;
        });
        bool caught = false;
        bool sawAnswer = false;
        try
        {
            await foreach (var update in wrapper.RunStreamingAsync([new ChatMessage(ChatRole.User, "What is 2 + 2?")],
                options: options, cancellationToken: cancellation.Token))
            {
                if (update.Text == "4")
                {
                    sawAnswer = true;
                    Equal(0, owned.Single().DisposeCount);
                    if (exit == "early-break") break;
                }
            }
        }
        catch (OperationCanceledException) when (exit == "cancel" && cancellation.IsCancellationRequested) { caught = true; }
        catch (InvalidOperationException ex) when (ReferenceEquals(ex, failure)) { caught = true; }
        catch (InvalidOperationException ex) when (exit == "caller-null" && ex.Message == "The caller chat client factory returned null.") { caught = true; }
        catch (InvalidOperationException ex) when (exit == "builder-null" && ex.Message == "The answer pipeline builder returned null.") { caught = true; }
        Equal(exit is not ("complete" or "early-break"), caught);
        Equal(exit is "complete" or "early-break", sawAnswer);
        Equal(exit == "builder-null" ? 0 : 1, owned.Count);
        foreach (var pipeline in owned)
        {
            Equal(1, pipeline.DisposeCount);
            True(!pipeline.DisposedWhileActive, "Pipeline disposed before its provider iterator unwound");
        }
        Equal(0, provider.ActiveEnumerators);
        Equal(0, provider.DisposeCount);
        Equal(0, original.DisposeCount);
        provider.Failure = null;
        provider.OnAnswer = null;
        // The original/shared first-pass pipeline remains usable after every exit.
        var ordinary = await Drain(wrapper, [new(ChatRole.User, "What is 2 + 2?")], null, Options(null));
        Equal("4", Prose(ordinary));
        Equal(exit == "builder-null" ? 0 : 1, owned.Count);
    }));
}

cases.Add(("answer pipeline ownership is independent for overlapping requests", async () =>
{
    var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    int answers = 0;
    var provider = new LifetimeChatClient
    {
        WaitOnAnswer = async token =>
        {
            if (Interlocked.Increment(ref answers) == 2) entered.SetResult();
            await release.Task.WaitAsync(token);
        }
    };
    var original = new DisposalTrackingChatClient(provider, () => provider.ActiveEnumerators > 0);
    var inner = new ChatClientAgent(original, new ChatClientAgentOptions { UseProvidedChatClientAsIs = true });
    var owned = new System.Collections.Concurrent.ConcurrentBag<DisposalTrackingChatClient>();
    var wrapper = new SharedStateAgent(inner, JsonSerializerOptions.Web, decorate =>
    {
        var pipeline = new DisposalTrackingChatClient(decorate(provider), () => false);
        owned.Add(pipeline);
        return pipeline;
    });
    var first = Drain(wrapper, [new(ChatRole.User, "First question")], await inner.CreateSessionAsync(), Options("{\"proverbs\":[]}"));
    var second = Drain(wrapper, [new(ChatRole.User, "Second question")], await inner.CreateSessionAsync(), Options("{\"proverbs\":[]}"));
    try
    {
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Equal(2, owned.Count);
        True(owned.All(pipeline => pipeline.DisposeCount == 0), "An active answer lost its pipeline");
        True(!ReferenceEquals(owned.First(), owned.Last()), "Requests shared an answer pipeline");
    }
    finally { release.TrySetResult(); }
    foreach (var output in await Task.WhenAll(first, second))
    {
        Equal("4", Prose(output));
        Equal(1, Data(output).Count);
    }
    True(owned.All(pipeline => pipeline.DisposeCount == 1), "An answer pipeline was not released exactly once");
    Equal(0, provider.DisposeCount);
    Equal(0, original.DisposeCount);
}));

cases.Add(("answer builder is required and repeated construction releases its first pipeline", async () =>
{
    var provider = new LifetimeChatClient();
    DisposalTrackingChatClient? owned = null;
    var fake = new ScriptedAgent(call =>
    {
        if (call.Number == 1) return [Text("{\"proverbs\":[]}")];
        var factory = ((ChatClientAgentRunOptions)call.Options!).ChatClientFactory!;
        factory(provider);
        factory(provider);
        throw new Exception("Repeated answer construction was accepted");
    });
    bool rejectedNull = false;
    try { _ = new SharedStateAgent(fake, JsonSerializerOptions.Web, null!); }
    catch (ArgumentNullException ex) when (ex.ParamName == "buildAnswerClient") { rejectedNull = true; }
    True(rejectedNull, "Null answer builder was accepted");
    True(typeof(SharedStateAgent).GetConstructors().All(constructor => constructor.GetParameters().Length == 3),
        "Unsafe two-argument constructor remains available");
    var wrapper = new SharedStateAgent(fake, JsonSerializerOptions.Web,
        decorate => owned = new DisposalTrackingChatClient(decorate(provider), () => provider.ActiveEnumerators > 0));
    bool rejectedRepeat = false;
    try { await Drain(wrapper, [new(ChatRole.User, "Hello")], null, Options("{\"proverbs\":[]}")); }
    catch (InvalidOperationException ex) when (ex.Message == "The answer pipeline was already constructed for this run.") { rejectedRepeat = true; }
    True(rejectedRepeat, "Repeated answer construction was accepted");
    Equal(1, owned!.DisposeCount);
    Equal(0, provider.DisposeCount);
}));

cases.Add(("provider boundary preserves mixed response objects in both response methods", async () =>
{
    var raw = new object();
    var properties = new AdditionalPropertiesDictionary { ["boundary"] = "retained" };
    var usage = new UsageDetails { InputTokenCount = 3, OutputTokenCount = 4 };
    var created = new DateTimeOffset(2026, 10, 26, 1, 2, 3, TimeSpan.Zero);
    var responseCall = new FunctionCallContent("boundary-response-call", "hidden_mutator", new Dictionary<string, object?> { ["value"] = 7 });
    var streamCall = new FunctionCallContent("boundary-stream-call", "hidden_mutator", new Dictionary<string, object?> { ["value"] = 8 });
    var firstPassCall = new FunctionCallContent("boundary-state-call", "state_tool");
    var responseContents = new List<AIContent> { new TextContent("4"), responseCall, new UsageContent(usage) };
    var streamContents = new List<AIContent> { new TextContent("4"), streamCall, new UsageContent(usage) };
    var response = new ChatResponse(new ChatMessage(ChatRole.Assistant, responseContents))
    {
        ResponseId = "boundary-response", ModelId = "boundary-model", CreatedAt = created,
        FinishReason = ChatFinishReason.ToolCalls, Usage = usage, RawRepresentation = raw, AdditionalProperties = properties
    };
    var update = new ChatResponseUpdate(ChatRole.Assistant, streamContents)
    {
        ResponseId = "boundary-stream", MessageId = "boundary-message", ModelId = "boundary-model",
        AuthorName = "boundary-author", CreatedAt = created, FinishReason = ChatFinishReason.ToolCalls,
        RawRepresentation = raw, AdditionalProperties = properties
    };
    var provider = new LifetimeChatClient
    {
        AnswerResponse = response, AnswerUpdate = update,
        StateUpdate = new ChatResponseUpdate(ChatRole.Assistant, [new TextContent("{\"proverbs\":[]}"), firstPassCall])
    };
    var defaultTools = new List<AITool>();
    var defaultProperties = new AdditionalPropertiesDictionary { ["default-sentinel"] = "retained" };
    var defaultOptions = new ChatOptions { Tools = defaultTools, AdditionalProperties = defaultProperties };
    var inner = new ChatClientAgent(provider, new ChatClientAgentOptions { UseProvidedChatClientAsIs = true, ChatOptions = defaultOptions });
    int factories = 0;
    bool inspectedResponse = false;
    bool inspectedUpdate = false;
    var options = Options("{\"proverbs\":[]}");
    options.ChatClientFactory = next => ++factories == 1 ? next : new BoundaryInspectionChatClient(next,
        observed =>
        {
            inspectedResponse = true;
            Same(response, observed);
            Same(responseContents, observed.Messages.Single().Contents);
            True(responseCall.InformationalOnly, "Non-streaming provider call was not marked");
            Equal("boundary-response", observed.ResponseId);
            Equal(created, observed.CreatedAt);
            Equal(ChatFinishReason.ToolCalls, observed.FinishReason);
            Same(usage, observed.Usage);
            Same(raw, observed.RawRepresentation);
            Same(properties, observed.AdditionalProperties);
        }, observed =>
        {
            inspectedUpdate = true;
            Same(update, observed);
            Same(streamContents, observed.Contents);
            True(streamCall.InformationalOnly, "Streaming provider call was not marked");
            Equal("boundary-stream", observed.ResponseId);
            Equal("boundary-message", observed.MessageId);
            Equal("boundary-model", observed.ModelId);
            Equal("boundary-author", observed.AuthorName);
            Equal(created, observed.CreatedAt);
            Equal(ChatFinishReason.ToolCalls, observed.FinishReason);
            Same(raw, observed.RawRepresentation);
            Same(properties, observed.AdditionalProperties);
        });
    var wrapper = new SharedStateAgent(inner, JsonSerializerOptions.Web, decorate => decorate(provider));
    var output = await Drain(wrapper, [new(ChatRole.User, "What is 2 + 2?")], null, options);
    True(inspectedResponse && inspectedUpdate, "Both response methods were not exercised");
    True(!firstPassCall.InformationalOnly, "State-pass call was marked read-only");
    Equal("4", Prose(output));
    Equal(1, Data(output).Count);
    foreach (var contents in new[] { responseContents, streamContents })
    {
        Equal(3, contents.Count);
        Equal("4", ((TextContent)contents[0]).Text);
        True(contents[1] is FunctionCallContent, "Mixed content order changed");
        True(contents[2] is UsageContent, "Usage content order changed");
    }
    Equal("boundary-response-call", responseCall.CallId);
    Equal("boundary-stream-call", streamCall.CallId);
    Equal("hidden_mutator", responseCall.Name);
    Equal("hidden_mutator", streamCall.Name);
    Equal(7, responseCall.Arguments!["value"]);
    Equal(8, streamCall.Arguments!["value"]);
    Same(defaultTools, defaultOptions.Tools);
    Same(defaultProperties, defaultOptions.AdditionalProperties);
    Equal(0, defaultTools.Count);
    Equal(1, defaultProperties.Count);
    Equal("retained", defaultProperties["default-sentinel"]);
    Equal(0, provider.DisposeCount);
}));

cases.Add(("structured and answer phases preserve base metadata and the caller history provider", async () =>
{
    const string snapshot = "{\"proverbs\":[]}";
    const string question = "What is 2 + 2? (metadata request)";
    const string defaultContext = "Prior context from default history A.";
    const string overrideContext = "Prior context from caller history B.";
    int defaultLoads = 0, defaultStores = 0, overrideLoads = 0, overrideStores = 0;
    // These are the actual SDK stores; the filters only observe operations and
    // return the original messages without changing SDK history behavior.
    var defaultHistory = new InMemoryChatHistoryProvider(new()
    {
        StateKey = "phase-default-history",
        ProvideOutputMessageFilter = messages => { defaultLoads++; return messages; },
        StorageInputResponseMessageFilter = messages => { defaultStores++; return messages; }
    });
    var overrideHistory = new InMemoryChatHistoryProvider(new()
    {
        StateKey = "phase-override-history",
        ProvideOutputMessageFilter = messages => { overrideLoads++; return messages; },
        StorageInputResponseMessageFilter = messages => { overrideStores++; return messages; }
    });
    var provider = new PhaseContextChatClient(snapshot);
    var inner = new ChatClientAgent(provider, new ChatClientAgentOptions
    {
        UseProvidedChatClientAsIs = true, ChatHistoryProvider = defaultHistory
    });
    var session = await inner.CreateSessionAsync();
    defaultHistory.SetMessages(session, [new(ChatRole.Assistant, defaultContext)]);
    overrideHistory.SetMessages(session, [new(ChatRole.Assistant, overrideContext)]);
    var options = Options(snapshot);
    var chatProperties = options.ChatOptions!.AdditionalProperties!;
    chatProperties["phase-metadata"] = "chat-level";
    chatProperties.Add<ChatHistoryProvider>(defaultHistory);
    var originalChatEntries = chatProperties.ToArray();
    var baseProperties = new AdditionalPropertiesDictionary { ["phase-metadata"] = "base-level" };
    baseProperties.Add<ChatHistoryProvider>(overrideHistory);
    options.AdditionalProperties = baseProperties;
    using var cancellation = new CancellationTokenSource();
    var output = await Drain(new SharedStateAgent(inner, JsonSerializerOptions.Web, decorate => decorate(provider)),
        [new(ChatRole.User, question)], session, options, cancellation.Token);
    // Check what the real provider received first, rather than clone identity.
    Equal("base-level", provider.Calls[0].Properties["phase-metadata"]);
    Equal(2, provider.Calls.Count);
    True(provider.Calls[0].Structured && !provider.Calls[1].Structured, "Phase response formats changed");
    foreach (var call in provider.Calls)
    {
        Equal("base-level", call.Properties["phase-metadata"]);
        Equal(1, call.Messages.Count(message => message.Text == overrideContext));
        Equal(0, call.Messages.Count(message => message.Text == defaultContext));
        Same(session, call.Session);
        Equal(cancellation.Token, call.CancellationToken);
    }
    Equal(2, overrideLoads);
    True(overrideStores > 0, "The caller's history store never received the logical turn");
    Equal(0, defaultLoads);
    Equal(0, defaultStores);
    Equal(1, defaultHistory.GetMessages(session).Count);
    Equal(defaultContext, defaultHistory.GetMessages(session).Single().Text);
    True(overrideHistory.GetMessages(session).Any(message => message.Role == ChatRole.User && message.Text == question),
        "The caller's history store lost the original request");
    Equal("4", Prose(output));
    Equal(snapshot, Data(output).Single().GetRawText());
    Same(baseProperties, options.AdditionalProperties);
    Same(chatProperties, options.ChatOptions.AdditionalProperties);
    Equal(2, baseProperties.Count);
    Equal("base-level", baseProperties["phase-metadata"]);
    True(baseProperties.TryGetValue(out ChatHistoryProvider? originalOverride), "Caller history override was removed");
    Same(overrideHistory, originalOverride);
    Equal(originalChatEntries.Length, chatProperties.Count);
    foreach (var entry in originalChatEntries) Equal(entry.Value, chatProperties[entry.Key]);
    Equal(ChatResponseFormat.Text, options.ChatOptions.ResponseFormat);
}));

cases.Add(("reused SDK session receives each logical turn once without internal phase history", async () =>
{
    const string snapshot = "{\"proverbs\":[]}";
    const string question = "What is 2 + 2? (reused session request)";
    const string followup = "And what is 2 + 2 again?";
    const string priorContext = "An earlier logical assistant answer.";
    var provider = new PhaseContextChatClient(snapshot);
    var inner = new ChatClientAgent(provider, new ChatClientAgentOptions { UseProvidedChatClientAsIs = true });
    var history = (InMemoryChatHistoryProvider)inner.ChatHistoryProvider!;
    var session = await inner.CreateSessionAsync();
    history.SetMessages(session, [new(ChatRole.Assistant, priorContext)]);
    var wrapper = new SharedStateAgent(inner, JsonSerializerOptions.Web, decorate => decorate(provider));
    var output = await Drain(wrapper, [new(ChatRole.User, question)], session, Options(snapshot));
    var answer = provider.Calls[1];
    // The SDK's actual answer input is the first oracle; no fake deduplication
    // or renderer interpretation can satisfy this count.
    Equal(1, answer.Messages.Count(message => message.Role == ChatRole.User && message.Text == question));
    Equal(1, answer.Messages.Count(message => message.Role == ChatRole.Assistant && message.Text == snapshot));
    Equal(1, provider.Calls[0].Messages.Count(message => message.Text == priorContext));
    Equal(1, answer.Messages.Count(message => message.Text == priorContext));
    Equal(0, answer.Messages.Count(message => message.Role == ChatRole.System &&
        message.Text.Contains("Here is the current state in JSON format:", StringComparison.Ordinal)));
    Equal(2, provider.Calls.Count);
    True(provider.Calls[0].Structured && !answer.Structured, "Expected one state pass and one answer pass");
    True(provider.Calls.All(call => ReferenceEquals(call.Session, session)), "The compatible session was not forwarded");
    Equal("4", Prose(output));
    Equal(snapshot, Data(output).Single().GetRawText());
    var stored = history.GetMessages(session).ToList();
    Equal(1, stored.Count(message => message.Text == priorContext));
    Equal(1, stored.Count(message => message.Role == ChatRole.User && message.Text == question));
    Equal(1, stored.Count(message => message.Role == ChatRole.Assistant && message.Text == "4"));
    Equal(0, stored.Count(message => message.Text == snapshot));
    Equal(0, stored.Count(message => message.Role == ChatRole.System));
    var ordinary = await Drain(wrapper, [new(ChatRole.User, followup)], session, Options(null));
    Equal(3, provider.Calls.Count);
    var subsequent = provider.Calls[2];
    Equal(1, subsequent.Messages.Count(message => message.Text == priorContext));
    Equal(1, subsequent.Messages.Count(message => message.Role == ChatRole.User && message.Text == question));
    Equal(1, subsequent.Messages.Count(message => message.Role == ChatRole.User && message.Text == followup));
    Equal(1, subsequent.Messages.Count(message => message.Role == ChatRole.Assistant && message.Text == "4"));
    Equal(0, subsequent.Messages.Count(message => message.Text == snapshot));
    Equal(0, subsequent.Messages.Count(message => message.Role == ChatRole.System));
    Same(session, subsequent.Session);
    Equal("4", Prose(ordinary));
    Equal(0, Data(ordinary).Count);
    stored = history.GetMessages(session).ToList();
    Equal(1, stored.Count(message => message.Text == priorContext));
    Equal(1, stored.Count(message => message.Role == ChatRole.User && message.Text == question));
    Equal(1, stored.Count(message => message.Role == ChatRole.User && message.Text == followup));
    Equal(2, stored.Count(message => message.Role == ChatRole.Assistant && message.Text == "4"));
    Equal(0, stored.Count(message => message.Text == snapshot));
    Equal(0, stored.Count(message => message.Role == ChatRole.System));
}));

cases.Add(("real SDK prose fallback stores only the logical request and actual response", async () =>
{
    const string question = "Answer normally without changing the proverbs.";
    const string prose = "There are no changes to make.";
    const string followup = "What is 2 + 2? (after prose fallback)";
    var provider = new PhaseContextChatClient(prose);
    var inner = new ChatClientAgent(provider, new ChatClientAgentOptions { UseProvidedChatClientAsIs = true });
    var history = (InMemoryChatHistoryProvider)inner.ChatHistoryProvider!;
    var session = await inner.CreateSessionAsync();
    var wrapper = new SharedStateAgent(inner, JsonSerializerOptions.Web, UnexpectedChatClientConstruction);
    var output = await Drain(wrapper, [new(ChatRole.User, question)], session, Options("{\"proverbs\":[]}"));
    var stored = history.GetMessages(session).ToList();
    // A rejected snapshot must not commit its synthetic state prompt either.
    Equal(0, stored.Count(message => message.Role == ChatRole.System));
    Equal(1, stored.Count(message => message.Role == ChatRole.User && message.Text == question));
    Equal(1, stored.Count(message => message.Role == ChatRole.Assistant && message.Text == prose));
    Equal(1, provider.Calls.Count);
    True(provider.Calls[0].Structured, "Fallback did not originate in the structured pass");
    Equal(prose, Prose(output));
    Equal(0, Data(output).Count);
    var ordinary = await Drain(wrapper, [new(ChatRole.User, followup)], session, Options(null));
    Equal(2, provider.Calls.Count);
    var subsequent = provider.Calls[1];
    Equal(1, subsequent.Messages.Count(message => message.Role == ChatRole.User && message.Text == question));
    Equal(1, subsequent.Messages.Count(message => message.Role == ChatRole.Assistant && message.Text == prose));
    Equal(1, subsequent.Messages.Count(message => message.Role == ChatRole.User && message.Text == followup));
    Equal(0, subsequent.Messages.Count(message => message.Role == ChatRole.System));
    Equal("4", Prose(ordinary));
    Equal(0, Data(ordinary).Count);
    stored = history.GetMessages(session).ToList();
    Equal(1, stored.Count(message => message.Role == ChatRole.User && message.Text == question));
    Equal(1, stored.Count(message => message.Role == ChatRole.Assistant && message.Text == prose));
    Equal(1, stored.Count(message => message.Role == ChatRole.User && message.Text == followup));
    Equal(1, stored.Count(message => message.Role == ChatRole.Assistant && message.Text == "4"));
    Equal(0, stored.Count(message => message.Role == ChatRole.System));
}));

cases.Add(("null SDK session still receives complete answer context once", async () =>
{
    const string snapshot = "{\"proverbs\":[]}";
    const string question = "What is 2 + 2? (null session request)";
    var provider = new PhaseContextChatClient(snapshot);
    var agentOptions = new ChatClientAgentOptions();
    var inner = new ChatClientAgent(provider, agentOptions);
    var output = await Drain(new SharedStateAgent(inner, JsonSerializerOptions.Web,
        decorate => new ChatClientAgent(decorate(provider), agentOptions).ChatClient),
        [new(ChatRole.User, question)], null, Options(snapshot));
    var answer = provider.Calls[1];
    Equal(1, answer.Messages.Count(message => message.Role == ChatRole.User && message.Text == question));
    Equal(1, answer.Messages.Count(message => message.Role == ChatRole.Assistant && message.Text == snapshot));
    Equal(0, answer.Messages.Count(message => message.Role == ChatRole.System &&
        message.Text.Contains("Here is the current state in JSON format:", StringComparison.Ordinal)));
    Equal(2, provider.Calls.Count);
    True(provider.Calls[0].Structured && !answer.Structured, "Expected one state pass and one answer pass");
    True(provider.Calls.All(call => call.Session is not null), "SDK did not resolve compatible sessions");
    Equal("4", Prose(output));
    Equal(snapshot, Data(output).Single().GetRawText());
}));

cases.Add(("real SDK tool fallback retains its complete logical response in history", async () =>
{
    const string callId = "fallback-weather-call";
    const string expectedCity = "Bergen-fallback-73";
    const string prose = "The weather tool returned the requested humidity.";
    const string question = "Check the weather without changing my proverbs.";
    const string followup = "What humidity did that weather tool return?";
    int toolCalls = 0;
    var weather = AIFunctionFactory.Create((Func<string, JsonElement>)((string city) =>
    {
        toolCalls++;
        return JsonSerializer.SerializeToElement(new { city, humidity = 73 });
    }), options: new() { Name = "get_weather" });
    var provider = new ToolFallbackChatClient(callId, weather.Name, expectedCity, prose);
    var configured = new FunctionInvokingChatClient(provider) { AdditionalTools = [weather] };
    var inner = new ChatClientAgent(configured, new ChatClientAgentOptions
    {
        UseProvidedChatClientAsIs = true, ChatOptions = new ChatOptions { Tools = [weather] }
    });
    var history = (InMemoryChatHistoryProvider)inner.ChatHistoryProvider!;
    var session = await inner.CreateSessionAsync();
    var wrapper = new SharedStateAgent(inner, JsonSerializerOptions.Web, UnexpectedChatClientConstruction);
    var output = await Drain(wrapper, [new(ChatRole.User, question)], session, Options("{\"proverbs\":[]}"));
    Equal(1, toolCalls); // Only the actual configured SDK invoker calls this delegate.
    var stored = history.GetMessages(session).ToList();
    Equal(1, stored.SelectMany(message => message.Contents).OfType<FunctionResultContent>().Count(result => result.CallId == callId));
    var visibleCall = output.SelectMany(update => update.Contents).OfType<FunctionCallContent>().Single();
    var visibleResult = output.SelectMany(update => update.Contents).OfType<FunctionResultContent>().Single();
    Equal(callId, visibleCall.CallId);
    Equal(callId, visibleResult.CallId);
    Equal(expectedCity, JsonSerializer.SerializeToElement(visibleCall.Arguments).GetProperty("city").GetString());
    Equal(73, JsonSerializer.SerializeToElement(visibleResult.Result).GetProperty("humidity").GetInt32());
    Equal(expectedCity, JsonSerializer.SerializeToElement(visibleResult.Result).GetProperty("city").GetString());
    Equal(prose, Prose(output));
    Equal(0, Data(output).Count);
    Equal(2, provider.Calls.Count);
    AssertWeatherResponse(provider.Calls[1]); // The SDK really supplied the delegate's result on its follow-up.
    AssertWeatherResponse(stored);
    Equal(1, stored.SelectMany(message => message.Contents).OfType<TextContent>().Count(text => text.Text == prose));
    Equal(1, stored.Count(message => message.Role == ChatRole.User && message.Text == question));
    Equal(0, stored.Count(message => message.Role == ChatRole.System));
    var ordinary = await Drain(wrapper, [new(ChatRole.User, followup)], session, Options(null));
    Equal(3, provider.Calls.Count);
    AssertWeatherResponse(provider.Calls[2]);
    Equal(1, provider.Calls[2].SelectMany(message => message.Contents).OfType<TextContent>().Count(text => text.Text == prose));
    Equal(1, provider.Calls[2].Count(message => message.Role == ChatRole.User && message.Text == followup));
    Equal(0, provider.Calls[2].Count(message => message.Role == ChatRole.System));
    Equal(1, toolCalls);
    Equal("Follow-up complete.", Prose(ordinary));
    Equal(0, Data(ordinary).Count);
    AssertWeatherResponse(history.GetMessages(session));

    void AssertWeatherResponse(IEnumerable<ChatMessage> messages)
    {
        var contents = messages.SelectMany(message => message.Contents).ToList();
        var call = contents.OfType<FunctionCallContent>().Single();
        var result = contents.OfType<FunctionResultContent>().Single();
        Equal(callId, call.CallId);
        Equal(weather.Name, call.Name);
        Equal(callId, result.CallId);
        Equal(expectedCity, JsonSerializer.SerializeToElement(call.Arguments).GetProperty("city").GetString());
        var payload = JsonSerializer.SerializeToElement(result.Result);
        Equal(73, payload.GetProperty("humidity").GetInt32());
        Equal(expectedCity, payload.GetProperty("city").GetString());
        Equal<Exception?>(null, result.Exception);
        True(contents.IndexOf(call) < contents.IndexOf(result), "Stored SDK tool result preceded its call");
        // The SDK's immediate tool follow-up has not received the final prose yet.
        if (contents.OfType<TextContent>().Any(text => text.Text == prose))
        {
            var text = contents.OfType<TextContent>().Single(content => content.Text == prose);
            True(contents.IndexOf(result) < contents.IndexOf(text), "Stored SDK prose preceded its tool result");
        }
    }
}));

cases.Add(("answer context contains the full merged resulting state without storing it", async () =>
{
    const string displayName = "Ada-Cedar-7f2a";
    const string updatedProverb = "After the state update, measure twice.";
    const string inputState = "{\"proverbs\":[\"Before the state update.\"],\"displayName\":\"Ada-Cedar-7f2a\"}";
    const string schemaSnapshot = "{\"proverbs\":[\"After the state update, measure twice.\"]}";
    const string question = "What display name and proverbs are in my resulting state?";
    var provider = new PhaseContextChatClient(schemaSnapshot);
    var agentOptions = new ChatClientAgentOptions();
    var inner = new ChatClientAgent(provider, agentOptions);
    var history = (InMemoryChatHistoryProvider)inner.ChatHistoryProvider!;
    var session = await inner.CreateSessionAsync();
    var options = Options(inputState);
    var originalChatOptions = options.ChatOptions;
    var wrapper = new SharedStateAgent(inner, JsonSerializerOptions.Web,
        decorate => new ChatClientAgent(decorate(provider), agentOptions).ChatClient);
    var output = await Drain(wrapper, [new(ChatRole.User, question)], session, options);
    var answer = provider.Calls[1];
    // Actual model-visible messages, not the fixture's canned prose, prove the
    // preserved extra field and updated proverbs reached the answering phase.
    Equal(1, answer.Messages.Count(message => ContainsMergedState(message.Text)));
    Equal(2, provider.Calls.Count);
    True(provider.Calls[0].Structured && !answer.Structured, "Expected one state pass and one answer pass");
    var published = Data(output).Single();
    Equal(displayName, published.GetProperty("displayName").GetString());
    Equal(updatedProverb, published.GetProperty("proverbs")[0].GetString());
    Equal(1, published.GetProperty("proverbs").GetArrayLength());
    Same(originalChatOptions, options.ChatOptions);
    True(options.ChatOptions!.TryGetRunAgentInput(out RunAgentInput? callerInput), "Original state context was removed");
    Equal(inputState, callerInput!.State!.Value.GetRawText());
    Equal("4", Prose(output)); // Completion control only; the context assertion above is the state oracle.
    AssertPrivateStateAbsent(history.GetMessages(session).Select(message => (message.Role, message.Text)));
    await Drain(wrapper, [new(ChatRole.User, "Ordinary follow-up after the state update.")], session, Options(null));
    Equal(3, provider.Calls.Count);
    AssertPrivateStateAbsent(provider.Calls[2].Messages);
    AssertPrivateStateAbsent(history.GetMessages(session).Select(message => (message.Role, message.Text)));

    bool ContainsMergedState(string text)
    {
        int start = text.IndexOf('{');
        int end = text.LastIndexOf('}');
        if (start < 0 || end < start) return false;
        try
        {
            using var document = JsonDocument.Parse(text[start..(end + 1)]);
            var state = document.RootElement;
            return state.ValueKind == JsonValueKind.Object &&
                state.TryGetProperty("displayName", out var name) && name.ValueKind == JsonValueKind.String && name.GetString() == displayName &&
                state.TryGetProperty("proverbs", out var proverbs) && proverbs.ValueKind == JsonValueKind.Array &&
                proverbs.GetArrayLength() == 1 && proverbs[0].ValueKind == JsonValueKind.String && proverbs[0].GetString() == updatedProverb;
        }
        catch (JsonException) { return false; }
    }

    void AssertPrivateStateAbsent(IEnumerable<(ChatRole Role, string Text)> messages)
    {
        var stored = messages.ToList();
        Equal(0, stored.Count(message => message.Role == ChatRole.System));
        Equal(0, stored.Count(message => message.Text.Contains(displayName, StringComparison.Ordinal)));
        Equal(0, stored.Count(message => message.Text.Contains(updatedProverb, StringComparison.Ordinal)));
        Equal(1, stored.Count(message => message.Role == ChatRole.User && message.Text == question));
    }
}));

foreach (var test in cases)
{
    try { await test.Run(); Console.WriteLine($"PASS {test.Name}"); }
    catch (Exception ex) { failures.Add(test.Name); Console.WriteLine($"FAIL {test.Name}: {ex.Message}"); }
}
Console.WriteLine($"{cases.Count - failures.Count}/{cases.Count} passed");
return failures.Count == 0 ? 0 : 1;

static AgentResponseUpdate Text(string text) => new(ChatRole.Assistant, text);
static IChatClient UnexpectedChatClientConstruction(Func<IChatClient, IChatClient> _) =>
    throw new Exception("A scripted agent must not construct an answer chat pipeline.");
static string Prose(IEnumerable<AgentResponseUpdate> updates) => string.Concat(updates.Select(u => u.Text));
static List<JsonElement> Data(IEnumerable<AgentResponseUpdate> updates) => updates.SelectMany(u => u.Contents).OfType<DataContent>().Select(d =>
{
    Equal("application/json", d.MediaType);
    return JsonDocument.Parse(d.Data).RootElement.Clone();
}).ToList();

static ChatClientAgentRunOptions Options(string? state)
{
    var input = new RunAgentInput
    {
        ThreadId = "regression-thread", RunId = "regression-run", Messages = [], Tools = [], Context = [],
        State = state is null ? null : JsonSerializer.Deserialize<JsonElement>(state)
    };
    var options = input.ToChatRequestContext(JsonSerializerOptions.Web).ChatOptions;
    options.ResponseFormat = ChatResponseFormat.Text;
    return new(options);
}

// Behave like an instruction-following provider: the old compulsory diff summary
// wins over the user's question; request-aware instructions produce its answer.
static string Answer(Call call, string question, string answer)
{
    var instruction = call.Messages.Last(m => m.Role == ChatRole.System).Text;
    if (instruction.Contains("summary of the state changes", StringComparison.OrdinalIgnoreCase)) return "There were no state changes.";
    if (instruction.Contains("answer", StringComparison.OrdinalIgnoreCase) &&
        instruction.Contains("original", StringComparison.OrdinalIgnoreCase) &&
        call.Messages.Any(m => m.Role == ChatRole.User && m.Text == question)) return answer;
    return "No request to answer the original question was supplied.";
}

static async Task<List<AgentResponseUpdate>> Drain(AIAgent agent, IEnumerable<ChatMessage> messages, AgentSession? session, AgentRunOptions? options, CancellationToken cancellationToken = default)
{
    var updates = new List<AgentResponseUpdate>();
    await foreach (var update in agent.RunStreamingAsync(messages, session, options, cancellationToken)) updates.Add(update);
    return updates;
}
static void True(bool condition, string message) { if (!condition) throw new Exception(message); }
static void Equal<T>(T expected, T actual) { if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new Exception($"Expected {expected}; got {actual}"); }
static void Same(object? expected, object? actual) => True(ReferenceEquals(expected, actual), "Expected the original object reference");

static void AssertReadOnlyAnswerOptions(ChatClientAgentRunOptions original, AgentRunOptions? observed)
{
    True(observed is ChatClientAgentRunOptions, "Expected chat run options on answer pass");
    var answer = (ChatClientAgentRunOptions)observed!;
    True(!ReferenceEquals(original, answer), "Answer pass must isolate its tool policy from the caller");
    True(!ReferenceEquals(original.ChatOptions, answer.ChatOptions), "Answer pass must clone chat options");
    Equal(ChatToolMode.None, answer.ChatOptions!.ToolMode);
    True(answer.ChatClientFactory is not null, "Answer pass needs an enforced non-invocable tool projection");
    // Opt into the experimental API only to verify caller token preservation.
#pragma warning disable MEAI001
    Equal(original.ContinuationToken, answer.ContinuationToken);
#pragma warning restore MEAI001
    Equal(original.AllowBackgroundResponses, answer.AllowBackgroundResponses);
    Equal(original.ResponseFormat, answer.ResponseFormat);
    Equal(original.ChatOptions!.ResponseFormat, answer.ChatOptions.ResponseFormat);
    Equal(original.ChatOptions.Temperature, answer.ChatOptions.Temperature);
    Equal(original.ChatOptions.ModelId, answer.ChatOptions.ModelId);
    Equal(original.ChatOptions.Instructions, answer.ChatOptions.Instructions);
    Equal(ChatResponseFormat.Text, original.ChatOptions.ResponseFormat);
}

sealed record Call(int Number, List<ChatMessage> Messages, AgentSession? Session, AgentRunOptions? Options, CancellationToken CancellationToken);

sealed class ScriptedAgent(Func<Call, IEnumerable<AgentResponseUpdate>> script) : AIAgent
{
    public List<Call> Calls { get; } = [];
    protected override ValueTask<AgentSession> CreateSessionCoreAsync(CancellationToken cancellationToken = default) => ValueTask.FromResult<AgentSession>(new TestSession());

    // This regression fake creates sessions but never persists them. Keep an
    // unexpected serialization path visible rather than inventing persistence.
    protected override ValueTask<JsonElement> SerializeSessionCoreAsync(
        AgentSession session,
        JsonSerializerOptions? jsonSerializerOptions = null,
        CancellationToken cancellationToken = default) =>
        throw new NotSupportedException("Session serialization is not used by these wrapper regressions.");

    protected override ValueTask<AgentSession> DeserializeSessionCoreAsync(
        JsonElement serializedState,
        JsonSerializerOptions? jsonSerializerOptions = null,
        CancellationToken cancellationToken = default) =>
        throw new NotSupportedException("Session deserialization is not used by these wrapper regressions.");

    protected override Task<AgentResponse> RunCoreAsync(IEnumerable<ChatMessage> messages, AgentSession? session = null, AgentRunOptions? options = null, CancellationToken cancellationToken = default) =>
        RunCoreStreamingAsync(messages, session, options, cancellationToken).ToAgentResponseAsync(cancellationToken);
    protected override async IAsyncEnumerable<AgentResponseUpdate> RunCoreStreamingAsync(IEnumerable<ChatMessage> messages, AgentSession? session = null, AgentRunOptions? options = null, [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var call = new Call(Calls.Count + 1, messages.ToList(), session, options, cancellationToken);
        Calls.Add(call);
        foreach (var update in script(call))
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return update;
            await Task.CompletedTask;
        }
    }
}
sealed class TestSession : AgentSession;
sealed class OnceMessages(IEnumerable<ChatMessage> messages) : IEnumerable<ChatMessage>
{
    private bool _enumerated;
    public IEnumerator<ChatMessage> GetEnumerator()
    {
        if (_enumerated) throw new Exception("Original messages were enumerated more than once");
        _enumerated = true;
        return messages.GetEnumerator();
    }
    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
}

sealed class MutationAttemptChatClient(string toolName, bool editInFirstPass, Func<string> snapshot) : IChatClient
{
    private bool _structuredCallAttempted;
    public bool AnswerAttempted { get; private set; }
    public List<AITool> AnswerTools { get; private set; } = [];
    public ChatToolMode? AnswerToolMode { get; private set; }
    public List<CancellationToken> Tokens { get; } = [];
    public List<AgentSession?> Sessions { get; } = [];
    public Task<ChatResponse> GetResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default) =>
        GetStreamingResponseAsync(messages, options, cancellationToken).ToChatResponseAsync(cancellationToken);
    public async IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
        IEnumerable<ChatMessage> messages, ChatOptions? options = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Tokens.Add(cancellationToken);
        Sessions.Add(AIAgent.CurrentRunContext?.Session);
        if (Tokens.Count > 8) throw new Exception("Unexpected unbounded function loop");
        if (options?.ResponseFormat is ChatResponseFormatJson)
        {
            if (editInFirstPass && !_structuredCallAttempted)
            {
                _structuredCallAttempted = true;
                yield return new ChatResponseUpdate(ChatRole.Assistant, [new FunctionCallContent("f4-first", toolName)])
                {
                    MessageId = "f4-structured-call", FinishReason = ChatFinishReason.ToolCalls
                };
            }
            else
            {
                yield return new ChatResponseUpdate(ChatRole.Assistant, snapshot())
                {
                    MessageId = "f4-structured-snapshot", FinishReason = ChatFinishReason.Stop
                };
            }
        }
        else if (!AnswerAttempted)
        {
            AnswerAttempted = true;
            AnswerTools = options?.Tools?.ToList() ?? [];
            AnswerToolMode = options?.ToolMode;
            // Deliberately disregard None. Only the SDK's local execution
            // boundary may prevent the function's real mutation.
            yield return new ChatResponseUpdate(ChatRole.Assistant,
                [new FunctionCallContent("f4-answer", toolName), new TextContent("Done.")])
            {
                MessageId = "f4-answer-call", FinishReason = ChatFinishReason.ToolCalls
            };
        }
        else
        {
            // The unsafe baseline invokes the function then makes one more
            // provider call. Return no additional prose so the side-effect
            // assertion, rather than duplicated canned text, exposes the bug.
            yield return new ChatResponseUpdate(ChatRole.Assistant, "")
            {
                MessageId = "f4-answer-followup", FinishReason = ChatFinishReason.Stop
            };
        }
        await Task.CompletedTask;
    }
    public object? GetService(Type serviceType, object? serviceKey = null) =>
        serviceKey is null && serviceType.IsInstanceOfType(this) ? this : null;
    public void Dispose() { }
}

sealed class NestedMutationAttemptChatClient(string[] toolNames, Func<string> snapshot) : IChatClient
{
    public bool AnswerAttempted { get; private set; }
    public string? AttemptedToolName { get; private set; }
    public List<AITool> AnswerTools { get; private set; } = [];
    public ChatToolMode? AnswerToolMode { get; private set; }
    public List<CancellationToken> Tokens { get; } = [];
    public List<AgentSession?> Sessions { get; } = [];
    public List<bool> RequestDecorations { get; } = [];
    public Task<ChatResponse> GetResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default) =>
        GetStreamingResponseAsync(messages, options, cancellationToken).ToChatResponseAsync(cancellationToken);
    public async IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
        IEnumerable<ChatMessage> messages, ChatOptions? options = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Tokens.Add(cancellationToken);
        Sessions.Add(AIAgent.CurrentRunContext?.Session);
        RequestDecorations.Add(options?.AdditionalProperties?.ContainsKey("r4-request-decorated") == true);
        if (Tokens.Count > 8) throw new Exception("Unexpected unbounded nested function loop");
        if (options?.ResponseFormat is ChatResponseFormatJson)
        {
            yield return new ChatResponseUpdate(ChatRole.Assistant, snapshot())
            {
                MessageId = "r4-structured-snapshot", FinishReason = ChatFinishReason.Stop
            };
        }
        else if (!AnswerAttempted)
        {
            AnswerAttempted = true;
            AnswerTools = options?.Tools?.ToList() ?? [];
            AnswerToolMode = options?.ToolMode;
            // Select adversarial provider input, without controlling execution:
            // only the real SDK invokers can call either mutation delegate.
            // Fall back when all names are shadowed so a future fix can pass.
            AttemptedToolName = toolNames.FirstOrDefault(name => !AnswerTools.Any(tool => tool.Name == name)) ?? toolNames[0];
            yield return new ChatResponseUpdate(ChatRole.Assistant,
                [new FunctionCallContent("r4-answer", AttemptedToolName), new TextContent("4")])
            {
                MessageId = "r4-answer-call", FinishReason = ChatFinishReason.ToolCalls
            };
        }
        else
        {
            yield return new ChatResponseUpdate(ChatRole.Assistant, "")
            {
                MessageId = "r4-answer-followup", FinishReason = ChatFinishReason.Stop
            };
        }
        await Task.CompletedTask;
    }
    public object? GetService(Type serviceType, object? serviceKey = null) =>
        serviceKey is null && serviceType.IsInstanceOfType(this) ? this : null;
    public void Dispose() { }
}

sealed class DisposalTrackingChatClient(IChatClient innerClient, Func<bool> isActive) : DelegatingChatClient(innerClient)
{
    public int DisposeCount { get; private set; }
    public bool DisposedWhileActive { get; private set; }
    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            DisposeCount++;
            DisposedWhileActive |= isActive();
        }
        base.Dispose(disposing);
    }
}

sealed class LifetimeChatClient : IChatClient
{
    private int _activeEnumerators;
    public int ActiveEnumerators => Volatile.Read(ref _activeEnumerators);
    public int DisposeCount { get; private set; }
    public Exception? Failure { get; set; }
    public Action? OnAnswer { get; set; }
    public Func<CancellationToken, Task>? WaitOnAnswer { get; set; }
    public ChatResponse? AnswerResponse { get; set; }
    public ChatResponseUpdate? AnswerUpdate { get; set; }
    public ChatResponseUpdate? StateUpdate { get; set; }
    public Task<ChatResponse> GetResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (DisposeCount > 0) throw new ObjectDisposedException(nameof(LifetimeChatClient));
        return Task.FromResult(AnswerResponse ?? new ChatResponse(new ChatMessage(ChatRole.Assistant, "4")));
    }
    public async IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
        IEnumerable<ChatMessage> messages, ChatOptions? options = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (DisposeCount > 0) throw new ObjectDisposedException(nameof(LifetimeChatClient));
        Interlocked.Increment(ref _activeEnumerators);
        try
        {
            if (options?.ResponseFormat is ChatResponseFormatJson)
            {
                yield return StateUpdate ?? new ChatResponseUpdate(ChatRole.Assistant, "{\"proverbs\":[]}");
            }
            else
            {
                OnAnswer?.Invoke();
                cancellationToken.ThrowIfCancellationRequested();
                if (Failure is { } failure) throw failure;
                if (WaitOnAnswer is { } wait) await wait(cancellationToken);
                yield return AnswerUpdate ?? new ChatResponseUpdate(ChatRole.Assistant, "4");
            }
        }
        finally { Interlocked.Decrement(ref _activeEnumerators); }
    }
    public object? GetService(Type serviceType, object? serviceKey = null) =>
        serviceKey is null && serviceType.IsInstanceOfType(this) ? this : null;
    public void Dispose() => DisposeCount++;
}

sealed class BoundaryInspectionChatClient(IChatClient innerClient,
    Action<ChatResponse> inspectResponse, Action<ChatResponseUpdate> inspectUpdate) : DelegatingChatClient(innerClient)
{
    public override async IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
        IEnumerable<ChatMessage> messages, ChatOptions? options = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        inspectResponse(await InnerClient.GetResponseAsync(messages, options, cancellationToken));
        await foreach (var update in InnerClient.GetStreamingResponseAsync(messages, options, cancellationToken))
        {
            inspectUpdate(update);
            yield return update;
        }
    }
}

sealed record PhaseContextCall(bool Structured, List<(ChatRole Role, string Text)> Messages,
    AdditionalPropertiesDictionary Properties, AgentSession? Session, CancellationToken CancellationToken);

sealed class PhaseContextChatClient(string snapshot) : IChatClient
{
    public List<PhaseContextCall> Calls { get; } = [];
    public Task<ChatResponse> GetResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default) =>
        GetStreamingResponseAsync(messages, options, cancellationToken).ToChatResponseAsync(cancellationToken);
    public async IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
        IEnumerable<ChatMessage> messages, ChatOptions? options = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        bool structured = options?.ResponseFormat is ChatResponseFormatJson;
        // Freeze role/text values before the SDK subsequently stamps/stores the
        // original message objects. Observation does not change their history.
        Calls.Add(new(structured, messages.Select(message => (message.Role, message.Text)).ToList(),
            options?.AdditionalProperties?.Clone() ?? [], AIAgent.CurrentRunContext?.Session, cancellationToken));
        if (Calls.Count > 4) throw new Exception("Unexpected unbounded phase-context provider calls");
        yield return new ChatResponseUpdate(ChatRole.Assistant, structured ? snapshot : "4")
        {
            MessageId = $"phase-context-{Calls.Count}", FinishReason = ChatFinishReason.Stop
        };
        await Task.CompletedTask;
    }
    public object? GetService(Type serviceType, object? serviceKey = null) =>
        serviceKey is null && serviceType.IsInstanceOfType(this) ? this : null;
    public void Dispose() { }
}

sealed class ToolFallbackChatClient(string callId, string toolName, string city, string prose) : IChatClient
{
    private bool _toolCallAttempted;
    public List<List<ChatMessage>> Calls { get; } = [];
    public Task<ChatResponse> GetResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default) =>
        GetStreamingResponseAsync(messages, options, cancellationToken).ToChatResponseAsync(cancellationToken);
    public async IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
        IEnumerable<ChatMessage> messages, ChatOptions? options = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Calls.Add(messages.ToList());
        if (Calls.Count > 4) throw new Exception("Unexpected unbounded fallback tool calls");
        if (options?.ResponseFormat is ChatResponseFormatJson && !_toolCallAttempted)
        {
            _toolCallAttempted = true;
            yield return new ChatResponseUpdate(ChatRole.Assistant,
                [new FunctionCallContent(callId, toolName, new Dictionary<string, object?> { ["city"] = city })])
            {
                MessageId = "fallback-weather-request", FinishReason = ChatFinishReason.ToolCalls
            };
        }
        else
        {
            yield return new ChatResponseUpdate(ChatRole.Assistant,
                options?.ResponseFormat is ChatResponseFormatJson ? prose : "Follow-up complete.")
            {
                MessageId = $"fallback-weather-response-{Calls.Count}", FinishReason = ChatFinishReason.Stop
            };
        }
        await Task.CompletedTask;
    }
    public object? GetService(Type serviceType, object? serviceKey = null) =>
        serviceKey is null && serviceType.IsInstanceOfType(this) ? this : null;
    public void Dispose() { }
}
