using System.Text.Json;
using Xunit;

// Alias the production type (declared in the default/global namespace) so the
// test file doesn't need to repeat `global::SharedStateAgent` at every call
// site. Access is via InternalsVisibleTo on the production csproj.
using SSA = SharedStateAgent;

namespace MsAgentDotnet.AgentTests;

public class StateContainsSalesDataTests
{
    private static JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement;

    public static IEnumerable<object[]> Cases()
    {
        // Case 1: state is a JSON null value (ValueKind == Null)
        yield return new object[] { "JsonNullValue", Parse("null"), false };

        // Case 2: state is an array (not an object)
        yield return new object[] { "TopLevelArray", Parse("[1,2,3]"), false };

        // Case 3: state is an object but todos is missing
        yield return new object[] { "TodosMissing", Parse("{\"other\":1}"), false };

        // Case 4: todos is an empty array
        yield return new object[] { "TodosEmptyArray", Parse("{\"todos\":[]}"), false };

        // Case 5: todos is a non-array value (an object)
        yield return new object[] { "TodosAsObject", Parse("{\"todos\":{}}"), false };

        // Case 6: todos is a non-array primitive (a string)
        yield return new object[] { "TodosAsString", Parse("{\"todos\":\"nope\"}"), false };

        // Case 7: todos is an array with non-object elements
        yield return new object[] { "TodosArrayOfPrimitives", Parse("{\"todos\":[1,2,3]}"), false };

        // Case 8: todos is populated with object elements
        yield return new object[]
        {
            "TodosPopulatedWithObjects",
            Parse("{\"todos\":[{\"id\":\"a\",\"title\":\"T1\",\"stage\":\"prospect\"}]}"),
            true,
        };
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void StateContainsSalesData_ReturnsExpected(string label, JsonElement state, bool expected)
    {
        // label is included for test-runner readability only; silence unused warnings.
        _ = label;
        var actual = SSA.StateContainsSalesData(state);
        Assert.Equal(expected, actual);
    }

    [Fact]
    public void StateContainsSalesData_MissingState_UndefinedValueKind_ReturnsFalse()
    {
        // JsonElement default (ValueKind == Undefined) simulates "no state attached".
        var undefined = default(JsonElement);
        Assert.Equal(JsonValueKind.Undefined, undefined.ValueKind);
        Assert.False(SSA.StateContainsSalesData(undefined));
    }
}
