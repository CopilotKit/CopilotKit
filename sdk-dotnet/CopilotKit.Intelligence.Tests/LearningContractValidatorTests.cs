using System.Text.Json;
using System.Text.Json.Nodes;
using CopilotKit.Intelligence;
using Xunit;

namespace CopilotKit.Intelligence.Tests;

/// <summary>
/// Runs the language-neutral conformance corpus through the C# portable
/// validator so that the corpus enforces the same contracts in C# that it
/// already enforces in TypeScript and Python. Before this suite existed the
/// corpus was only read here to extract the canonical error-code enums, which
/// left every declarative assertion unenforced in C#.
/// </summary>
public sealed class LearningContractValidatorTests : IDisposable
{
    private readonly JsonDocument _corpus = JsonDocument.Parse(File.ReadAllText(CorpusPath()));

    private static string CorpusPath() => Path.GetFullPath(Path.Combine(
        AppContext.BaseDirectory,
        "../../../../../packages/intelligence/conformance/learning-platform-v1.json"));

    public void Dispose() => _corpus.Dispose();

    [Fact]
    public void EveryCorpusCaseMatchesItsDeclaredValidity()
    {
        var root = _corpus.RootElement;
        var schemas = root.GetProperty("schemas");
        var validators = new Dictionary<string, Func<JsonElement, bool>>(StringComparer.Ordinal);
        var mismatches = new List<string>();
        var total = 0;

        foreach (var entry in root.GetProperty("cases").EnumerateArray())
        {
            total++;
            var name = entry.GetProperty("name").GetString()!;
            var schemaName = entry.GetProperty("schema").GetString()!;
            var expected = entry.GetProperty("valid").GetBoolean();
            if (!validators.TryGetValue(schemaName, out var validate))
            {
                validate = LearningContractValidator.Compile(schemas.GetProperty(schemaName));
                validators[schemaName] = validate;
            }
            var actual = validate(entry.GetProperty("value"));
            if (actual != expected)
                mismatches.Add($"{name} [{schemaName}]: got {actual} expected {expected}");
        }

        Assert.Equal(315, total);
        Assert.Equal(47, schemas.EnumerateObject().Count());
        Assert.Equal([], mismatches);
    }

    /// <summary>
    /// Guards against the validator quietly degrading into a plain Draft 2020-12
    /// checker: the custom keywords are the only thing that rejects these cases.
    /// </summary>
    [Fact]
    public void TheCustomKeywordsAreWhatRejectsTheAssertionOnlyNegativeCases()
    {
        var root = JsonNode.Parse(File.ReadAllText(CorpusPath()))!.AsObject();
        var documents = new List<JsonDocument>();
        try
        {
            var validators = new Dictionary<string, Func<JsonElement, bool>>(StringComparer.Ordinal);
            foreach (var pair in root["schemas"]!.AsObject())
            {
                var document = JsonDocument.Parse(WithoutCustomKeywords(pair.Value!.DeepClone())!.ToJsonString());
                documents.Add(document);
                validators[pair.Key] = LearningContractValidator.Compile(document.RootElement);
            }

            var accepted = 0;
            foreach (var entry in root["cases"]!.AsArray())
            {
                if (entry!["valid"]!.GetValue<bool>()) continue;
                using var value = JsonDocument.Parse(entry["value"]?.ToJsonString() ?? "null");
                if (validators[entry["schema"]!.GetValue<string>()](value.RootElement)) accepted++;
            }

            Assert.Equal(112, accepted);
        }
        finally
        {
            foreach (var document in documents) document.Dispose();
        }
    }

    [Fact]
    public void UnknownSchemaKeywordsFailLoudlyInsteadOfBeingIgnored()
    {
        using var schema = JsonDocument.Parse("""{"type":"object","x-future-copilotkit-keyword":true}""");
        using var value = JsonDocument.Parse("{}");
        var validate = LearningContractValidator.Compile(schema.RootElement);

        var error = Assert.Throws<LearningContractValidatorException>(() => validate(value.RootElement));

        Assert.Contains("x-future-copilotkit-keyword", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void UnknownAssertionOperationsFailLoudlyInsteadOfBeingIgnored()
    {
        using var schema = JsonDocument.Parse(
            """{"type":"object","x-copilotkit-assertions":[{"operation":"future-operation","values":"/a"}]}""");
        using var value = JsonDocument.Parse("""{"a":1}""");
        var validate = LearningContractValidator.Compile(schema.RootElement);

        var error = Assert.Throws<LearningContractValidatorException>(() => validate(value.RootElement));

        Assert.Contains("future-operation", error.Message, StringComparison.Ordinal);
    }

    /// <summary>
    /// .NET's "$" also matches before a trailing newline and its "\d" matches
    /// non-ASCII digits, so an untranslated ECMAScript pattern would accept
    /// strings the TypeScript reference validator rejects.
    /// </summary>
    [Theory]
    [InlineData("^[a-f0-9]{4}$", "abcd", true)]
    [InlineData("^[a-f0-9]{4}$", "abcd\n", false)]
    [InlineData("^\\d+$", "123", true)]
    [InlineData("^\\d+$", "١٢٣", false)]
    [InlineData("^a[\\s\\S]*z$", "az", true)]
    public void EcmaScriptPatternsKeepJavaScriptSemantics(string pattern, string candidate, bool expected)
    {
        using var schema = JsonDocument.Parse(
            $$"""{"type":"string","pattern":{{JsonSerializer.Serialize(pattern)}}}""");
        using var value = JsonDocument.Parse(JsonSerializer.Serialize(candidate));

        Assert.Equal(expected, LearningContractValidator.Compile(schema.RootElement)(value.RootElement));
    }

    /// <summary>
    /// The inline-payload key vocabulary backs the rule that downloadable Skills
    /// must never carry runtime user data, so its normalization has to survive
    /// NFKC forms, case, spacing, and dash or connector punctuation.
    /// </summary>
    [Theory]
    [InlineData("body", "body")]
    [InlineData("BODY", "body")]
    [InlineData("ｂｏｄｙ", "body")]
    [InlineData("in-line_body", "inlinebody")]
    [InlineData("in line body", "inlinebody")]
    [InlineData("Base‐64", "base64")]
    public void InlinePayloadKeyNormalizationIsUnicodeAware(string key, string expected) =>
        Assert.Equal(expected, LearningContractValidator.NormalizeInlineAttachmentPayloadKey(key));

    private static JsonNode? WithoutCustomKeywords(JsonNode? node)
    {
        if (node is JsonObject source)
        {
            var result = new JsonObject();
            foreach (var pair in source)
            {
                if (pair.Key is LearningContractValidator.AssertionsKeyword
                    or LearningContractValidator.EqualPropertiesKeyword) continue;
                result[pair.Key] = WithoutCustomKeywords(pair.Value?.DeepClone());
            }
            return result;
        }
        if (node is JsonArray array)
        {
            var result = new JsonArray();
            foreach (var item in array) result.Add(WithoutCustomKeywords(item?.DeepClone()));
            return result;
        }
        return node;
    }
}
