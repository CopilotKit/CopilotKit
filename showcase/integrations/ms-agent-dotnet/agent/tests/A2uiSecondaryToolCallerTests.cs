using Xunit;

namespace MsAgentDotnet.AgentTests;

// Exercises A2uiSecondaryToolCaller.ParseDesignToolArguments, the response-body
// parser that backs the A2UI secondary tool caller. The parser must:
//   * return the tool-call arguments on a well-formed response,
//   * return null for the expected "no usable tool call" cases, and
//   * throw A2uiUpstreamResponseException (NOT an uncaught KeyNotFoundException
//     or JsonException) for a structurally-malformed-but-2xx body, carrying the
//     upstream body for server-side logging.
public class A2uiSecondaryToolCallerParseTests
{
    private const string DesignTool = "_design_a2ui_surface";

    [Fact]
    public void WellFormedToolCall_ReturnsArguments()
    {
        var body = $$"""
        {
          "choices": [
            { "message": { "tool_calls": [
              { "function": { "name": "{{DesignTool}}", "arguments": "{\"surfaceId\":\"s\"}" } }
            ] } }
          ]
        }
        """;

        var result = A2uiSecondaryToolCaller.ParseDesignToolArguments(body);

        Assert.Equal("{\"surfaceId\":\"s\"}", result);
    }

    [Theory]
    [InlineData("{\"choices\":[]}")]                              // empty choices
    [InlineData("{\"other\":1}")]                                  // no choices
    [InlineData("{\"choices\":[{\"message\":{}}]}")]               // no tool_calls
    [InlineData("{\"choices\":[{\"message\":{\"tool_calls\":[]}}]}")] // empty tool_calls
    public void NoUsableToolCall_ReturnsNull(string body)
    {
        Assert.Null(A2uiSecondaryToolCaller.ParseDesignToolArguments(body));
    }

    [Fact]
    public void WrongToolName_ReturnsNull()
    {
        var body = """
        {"choices":[{"message":{"tool_calls":[{"function":{"name":"other","arguments":"{}"}}]}}]}
        """;

        Assert.Null(A2uiSecondaryToolCaller.ParseDesignToolArguments(body));
    }

    [Fact]
    public void NonJsonBody_Throws_WithBodyCaptured()
    {
        const string body = "not json at all";

        var ex = Assert.Throws<A2uiUpstreamResponseException>(
            () => A2uiSecondaryToolCaller.ParseDesignToolArguments(body));

        Assert.Equal(body, ex.Body);
    }

    [Fact]
    public void ChoiceWithoutMessage_Throws_InsteadOfKeyNotFound()
    {
        // A choice object that lacks "message" — the bare GetProperty would
        // have thrown an uncaught KeyNotFoundException before the guard.
        const string body = "{\"choices\":[{\"index\":0}]}";

        var ex = Assert.Throws<A2uiUpstreamResponseException>(
            () => A2uiSecondaryToolCaller.ParseDesignToolArguments(body));

        Assert.Equal(body, ex.Body);
    }

    [Fact]
    public void ToolCallWithoutFunction_Throws_InsteadOfKeyNotFound()
    {
        // A tool_calls entry that lacks "function" — the bare GetProperty would
        // have thrown an uncaught KeyNotFoundException before the guard.
        const string body = "{\"choices\":[{\"message\":{\"tool_calls\":[{\"id\":\"x\"}]}}]}";

        var ex = Assert.Throws<A2uiUpstreamResponseException>(
            () => A2uiSecondaryToolCaller.ParseDesignToolArguments(body));

        Assert.Equal(body, ex.Body);
    }
}
