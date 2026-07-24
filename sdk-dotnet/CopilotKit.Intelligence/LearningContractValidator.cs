using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace CopilotKit.Intelligence;

/// <summary>The schema uses a construct this validator refuses to guess about.</summary>
public sealed class LearningContractValidatorException : Exception
{
    /// <summary>Creates the exception with a diagnostic message.</summary>
    public LearningContractValidatorException(string message) : base(message) { }

    /// <summary>Creates the exception with a diagnostic message and cause.</summary>
    public LearningContractValidatorException(string message, Exception innerException)
        : base(message, innerException) { }
}

/// <summary>
/// Portable Learning Contract V1 schema validator.
/// </summary>
/// <remarks>
/// <para>
/// The language-neutral conformance corpus (<c>learning-platform-v1.json</c>) is
/// the specification for the Learning Platform wire contracts. Most of it is
/// ordinary JSON Schema Draft 2020-12, but the safety-bearing negative cases -
/// path and Unicode collisions, subject-hash equality, ordering, bounded JSON
/// trees, and the inline-payload key vocabulary that keeps user data out of
/// downloadable Skills - are expressed only through two custom keywords:
/// <c>x-copilotkit-equal-properties</c> and <c>x-copilotkit-assertions</c>.
/// A validator that ignores them accepts 112 of the corpus's negative cases.
/// </para>
/// <para>
/// This is the C# peer of <c>packages/intelligence/src/portable-validator.ts</c>.
/// Unknown schema keywords are a hard error rather than an ignored annotation so
/// that a future corpus keyword fails loudly instead of under-enforcing, and
/// ECMAScript <c>pattern</c> values are translated into .NET's dialect
/// explicitly because <c>$</c> would otherwise also match before a trailing
/// newline and <c>\d</c> would match non-ASCII digits.
/// </para>
/// </remarks>
public static class LearningContractValidator
{
    /// <summary>The sibling-property equality keyword.</summary>
    public const string EqualPropertiesKeyword = "x-copilotkit-equal-properties";

    /// <summary>The bounded declarative assertions keyword.</summary>
    public const string AssertionsKeyword = "x-copilotkit-assertions";

    /// <summary>The meta-schema that declares the custom semantics vocabulary.</summary>
    public const string MetaSchemaUri =
        "https://copilotkit.ai/schemas/intelligence/learning-platform/v1/candidate-semantics";

    private const int MaxBmpCodeUnit = 0xFFFF;

    private static readonly HashSet<string> IgnoredKeywords =
    [
        "$comment", "$defs", "$schema", "default", "deprecated", "description",
        "examples", "readOnly", "title", "writeOnly",
        // Ajv is configured with validateFormats: false, so "format" is a pure
        // annotation in the reference validator and must stay one here.
        "format",
    ];

    private static readonly HashSet<string> JsonTypes =
        ["array", "boolean", "integer", "null", "number", "object", "string"];

    /// <summary>Returns a reusable predicate for one Learning Contract V1 schema.</summary>
    public static Func<JsonElement, bool> Compile(JsonElement schema)
    {
        var root = schema;
        return value => ValidateSchema(root, schema, value);
    }

    /// <summary>Validates one value against one Learning Contract V1 schema.</summary>
    public static bool Validate(JsonElement schema, JsonElement value) => Compile(schema)(value);

    // ----------------------------------------------------------------------- //
    // Draft 2020-12 subset                                                    //
    // ----------------------------------------------------------------------- //

    private static bool ValidateSchema(JsonElement root, JsonElement schema, JsonElement value)
    {
        if (schema.ValueKind is JsonValueKind.True) return true;
        if (schema.ValueKind is JsonValueKind.False) return false;
        if (schema.ValueKind != JsonValueKind.Object)
            throw new LearningContractValidatorException($"Schema must be an object or boolean: {schema}");
        foreach (var keyword in schema.EnumerateObject())
        {
            if (IgnoredKeywords.Contains(keyword.Name)) continue;
            if (!ApplyKeyword(root, schema, keyword.Name, keyword.Value, value)) return false;
        }
        return true;
    }

    private static bool ApplyKeyword(
        JsonElement root, JsonElement schema, string keyword, JsonElement subschema, JsonElement value)
    {
        switch (keyword)
        {
            case "$ref":
                return ValidateSchema(root, Resolve(root, subschema), value);
            case "type":
                return MatchesDeclaredType(subschema, value);
            case "const":
                return JsonEqual(value, subschema);
            case "enum":
                return subschema.EnumerateArray().Any(candidate => JsonEqual(value, candidate));
            case "allOf":
                return subschema.EnumerateArray().All(entry => ValidateSchema(root, entry, value));
            case "anyOf":
                return subschema.EnumerateArray().Any(entry => ValidateSchema(root, entry, value));
            case "oneOf":
                return subschema.EnumerateArray().Count(entry => ValidateSchema(root, entry, value)) == 1;
            case "not":
                return !ValidateSchema(root, subschema, value);
            case "if":
                return ValidateSchema(root, subschema, value)
                    ? !schema.TryGetProperty("then", out var thenSchema) || ValidateSchema(root, thenSchema, value)
                    : !schema.TryGetProperty("else", out var elseSchema) || ValidateSchema(root, elseSchema, value);
            case "then":
            case "else":
                // Applied by "if"; inert on their own, exactly as in Draft 2020-12.
                return true;
            case "pattern":
                return value.ValueKind != JsonValueKind.String ||
                    EcmaScriptPattern(subschema.GetString()!).IsMatch(value.GetString()!);
            case "minLength":
                return value.ValueKind != JsonValueKind.String ||
                    CodePointLength(value.GetString()!) >= subschema.GetInt32();
            case "maxLength":
                return value.ValueKind != JsonValueKind.String ||
                    CodePointLength(value.GetString()!) <= subschema.GetInt32();
            case "minimum":
                return !IsNumber(value) || value.GetDouble() >= subschema.GetDouble();
            case "maximum":
                return !IsNumber(value) || value.GetDouble() <= subschema.GetDouble();
            case "exclusiveMinimum":
                return !IsNumber(value) || value.GetDouble() > subschema.GetDouble();
            case "exclusiveMaximum":
                return !IsNumber(value) || value.GetDouble() < subschema.GetDouble();
            case "multipleOf":
                return !IsNumber(value) || IsIntegral(value.GetDouble() / subschema.GetDouble());
            case "minItems":
                return value.ValueKind != JsonValueKind.Array || value.GetArrayLength() >= subschema.GetInt32();
            case "maxItems":
                return value.ValueKind != JsonValueKind.Array || value.GetArrayLength() <= subschema.GetInt32();
            case "uniqueItems":
                return subschema.ValueKind != JsonValueKind.True || value.ValueKind != JsonValueKind.Array ||
                    value.EnumerateArray().Select(AssertionValueKey).Distinct(StringComparer.Ordinal).Count()
                        == value.GetArrayLength();
            case "items":
                return value.ValueKind != JsonValueKind.Array ||
                    value.EnumerateArray().All(item => ValidateSchema(root, subschema, item));
            case "minProperties":
                return value.ValueKind != JsonValueKind.Object ||
                    value.EnumerateObject().Count() >= subschema.GetInt32();
            case "maxProperties":
                return value.ValueKind != JsonValueKind.Object ||
                    value.EnumerateObject().Count() <= subschema.GetInt32();
            case "required":
                return value.ValueKind != JsonValueKind.Object ||
                    subschema.EnumerateArray().All(name => value.TryGetProperty(name.GetString()!, out _));
            case "properties":
                return value.ValueKind != JsonValueKind.Object || subschema.EnumerateObject().All(property =>
                    !value.TryGetProperty(property.Name, out var child) ||
                    ValidateSchema(root, property.Value, child));
            case "additionalProperties":
                return value.ValueKind != JsonValueKind.Object || value.EnumerateObject().All(property =>
                    IsDeclaredProperty(schema, property.Name) ||
                    ValidateSchema(root, subschema, property.Value));
            case "propertyNames":
                return value.ValueKind != JsonValueKind.Object || value.EnumerateObject().All(property =>
                    ValidateSchema(root, subschema, JsonStringElement(property.Name)));
            case EqualPropertiesKeyword:
                // Ajv registers this with type: "object", so non-objects skip it.
                return value.ValueKind != JsonValueKind.Object || ValidateEqualProperties(subschema, value);
            case AssertionsKeyword:
                return value.ValueKind != JsonValueKind.Object || ValidateAssertions(subschema, value);
            default:
                throw new LearningContractValidatorException($"Unsupported JSON Schema keyword: {keyword}");
        }
    }

    private static bool IsDeclaredProperty(JsonElement schema, string name) =>
        schema.TryGetProperty("properties", out var declared) &&
        declared.ValueKind == JsonValueKind.Object &&
        declared.TryGetProperty(name, out _);

    private static bool MatchesDeclaredType(JsonElement subschema, JsonElement value)
    {
        if (subschema.ValueKind == JsonValueKind.String) return MatchesType(value, subschema.GetString()!);
        var declared = subschema.EnumerateArray().Select(entry => entry.GetString()!).ToArray();
        foreach (var candidate in declared)
            if (!JsonTypes.Contains(candidate))
                throw new LearningContractValidatorException($"Unsupported JSON type: {candidate}");
        return declared.Any(candidate => MatchesType(value, candidate));
    }

    private static bool MatchesType(JsonElement value, string expected) => expected switch
    {
        "null" => value.ValueKind == JsonValueKind.Null,
        "boolean" => value.ValueKind is JsonValueKind.True or JsonValueKind.False,
        "object" => value.ValueKind == JsonValueKind.Object,
        "array" => value.ValueKind == JsonValueKind.Array,
        "string" => value.ValueKind == JsonValueKind.String,
        "number" => IsNumber(value),
        "integer" => IsNumber(value) && IsIntegral(value.GetDouble()),
        _ => throw new LearningContractValidatorException($"Unsupported JSON type: {expected}"),
    };

    private static JsonElement Resolve(JsonElement root, JsonElement reference)
    {
        var pointer = reference.ValueKind == JsonValueKind.String ? reference.GetString() : null;
        if (pointer is null || !pointer.StartsWith("#/", StringComparison.Ordinal))
            throw new LearningContractValidatorException($"Only local JSON pointer $ref is supported: {reference}");
        var target = root;
        foreach (var segment in pointer[2..].Split('/'))
        {
            var decoded = DecodePointerSegment(segment);
            if (target.ValueKind != JsonValueKind.Object || !target.TryGetProperty(decoded, out target))
                throw new LearningContractValidatorException($"Unresolvable $ref: {pointer}");
        }
        return target;
    }

    private static bool IsNumber(JsonElement value) => value.ValueKind == JsonValueKind.Number;

    private static bool IsIntegral(double value) => !double.IsNaN(value) && !double.IsInfinity(value) &&
        Math.Floor(value) == value;

    private static int CodePointLength(string value)
    {
        var length = 0;
        for (var index = 0; index < value.Length; index++)
        {
            length++;
            if (char.IsHighSurrogate(value[index]) && index + 1 < value.Length &&
                char.IsLowSurrogate(value[index + 1]))
                index++;
        }
        return length;
    }

    /// <summary>Materializes a bare string as a JSON value for propertyNames.</summary>
    private static JsonElement JsonStringElement(string value) =>
        JsonDocument.Parse(JsonSerializer.Serialize(value)).RootElement.Clone();

    // ----------------------------------------------------------------------- //
    // JSON value equality and JavaScript-compatible serialization             //
    // ----------------------------------------------------------------------- //

    private static bool JsonEqual(JsonElement left, JsonElement right)
    {
        if (left.ValueKind != right.ValueKind)
        {
            // Numbers are the only kind whose spellings may differ.
            return IsNumber(left) && IsNumber(right) && left.GetDouble() == right.GetDouble();
        }
        switch (left.ValueKind)
        {
            case JsonValueKind.Null:
            case JsonValueKind.True:
            case JsonValueKind.False:
                return true;
            case JsonValueKind.Number:
                return left.GetDouble() == right.GetDouble();
            case JsonValueKind.String:
                return string.Equals(left.GetString(), right.GetString(), StringComparison.Ordinal);
            case JsonValueKind.Array:
                if (left.GetArrayLength() != right.GetArrayLength()) return false;
                return left.EnumerateArray().Zip(right.EnumerateArray()).All(pair => JsonEqual(pair.First, pair.Second));
            case JsonValueKind.Object:
                var rightProperties = right.EnumerateObject().ToDictionary(property => property.Name, property => property.Value, StringComparer.Ordinal);
                if (left.EnumerateObject().Count() != rightProperties.Count) return false;
                return left.EnumerateObject().All(property =>
                    rightProperties.TryGetValue(property.Name, out var other) && JsonEqual(property.Value, other));
            default:
                return false;
        }
    }

    /// <summary>Renders a number the way <c>String(value)</c> does in JavaScript.</summary>
    private static string JsNumber(double value)
    {
        if (double.IsNaN(value) || double.IsInfinity(value))
            throw new LearningContractValidatorException("Non-finite numbers are not JSON");
        if (Math.Floor(value) == value && Math.Abs(value) < 1e21)
        {
            return value == 0 ? "0" : value.ToString("F0", CultureInfo.InvariantCulture);
        }
        var rendered = value.ToString("R", CultureInfo.InvariantCulture);
        var exponentIndex = rendered.IndexOf('E');
        if (exponentIndex < 0) return rendered;
        var mantissa = rendered[..exponentIndex];
        var exponent = rendered[(exponentIndex + 1)..];
        var sign = exponent.StartsWith('-') ? "-" : "+";
        var digits = exponent.TrimStart('+', '-').TrimStart('0');
        return $"{mantissa}e{sign}{(digits.Length == 0 ? "0" : digits)}";
    }

    /// <summary><c>JSON.stringify</c> for JSON values, matching JavaScript byte for byte.</summary>
    private static string JsJson(JsonElement value)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Null:
                return "null";
            case JsonValueKind.True:
                return "true";
            case JsonValueKind.False:
                return "false";
            case JsonValueKind.Number:
                return JsNumber(value.GetDouble());
            case JsonValueKind.String:
                return JsJsonString(value.GetString()!);
            case JsonValueKind.Array:
                return "[" + string.Join(",", value.EnumerateArray().Select(JsJson)) + "]";
            case JsonValueKind.Object:
                return "{" + string.Join(",", value.EnumerateObject()
                    .Select(property => $"{JsJsonString(property.Name)}:{JsJson(property.Value)}")) + "}";
            default:
                throw new LearningContractValidatorException($"Not a JSON value: {value}");
        }
    }

    private static string JsJsonString(string value)
    {
        var builder = new StringBuilder(value.Length + 2).Append('"');
        foreach (var character in value)
        {
            switch (character)
            {
                case '"': builder.Append("\\\""); break;
                case '\\': builder.Append("\\\\"); break;
                case '\b': builder.Append("\\b"); break;
                case '\t': builder.Append("\\t"); break;
                case '\n': builder.Append("\\n"); break;
                case '\f': builder.Append("\\f"); break;
                case '\r': builder.Append("\\r"); break;
                default:
                    if (character < 0x20)
                        builder.Append(CultureInfo.InvariantCulture, $"\\u{(int)character:x4}");
                    else
                        builder.Append(character);
                    break;
            }
        }
        return builder.Append('"').ToString();
    }

    private static string JsTypeOf(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.True or JsonValueKind.False => "boolean",
        JsonValueKind.Number => "number",
        JsonValueKind.String => "string",
        _ => "object",
    };

    // ----------------------------------------------------------------------- //
    // ECMAScript pattern translation                                          //
    // ----------------------------------------------------------------------- //

    // The exact ECMAScript character-class shorthands. .NET's \d and \w are
    // Unicode-aware and .NET's \s disagrees with JavaScript's at U+001C-U+001F
    // and U+FEFF, so each shorthand is expanded into explicit ranges. Endpoints
    // are clamped to the BMP because .NET regexes match UTF-16 code units: an
    // astral character is two units, each individually inside the clamped range.
    private static readonly Dictionary<char, (int Low, int High)[]> ShorthandRanges = new()
    {
        ['d'] = [(0x30, 0x39)],
        ['w'] = [(0x30, 0x39), (0x41, 0x5A), (0x5F, 0x5F), (0x61, 0x7A)],
        ['s'] =
        [
            (0x09, 0x0D), (0x20, 0x20), (0xA0, 0xA0), (0x1680, 0x1680), (0x2000, 0x200A),
            (0x2028, 0x2029), (0x202F, 0x202F), (0x205F, 0x205F), (0x3000, 0x3000), (0xFEFF, 0xFEFF),
        ],
    };

    private static readonly string JsDot =
        $"[{RenderRanges(ComplementRanges([(0x0A, 0x0A), (0x0D, 0x0D), (0x2028, 0x2029)]))}]";

    private static readonly Dictionary<string, Regex> PatternCache = new(StringComparer.Ordinal);

    private static string RenderRanges(IReadOnlyList<(int Low, int High)> ranges) =>
        string.Concat(ranges.Select(range => range.Low == range.High
            ? EscapeCodeUnit(range.Low)
            : $"{EscapeCodeUnit(range.Low)}-{EscapeCodeUnit(range.High)}"));

    private static string EscapeCodeUnit(int codeUnit) =>
        $"\\u{codeUnit:X4}";

    private static List<(int Low, int High)> ComplementRanges(IEnumerable<(int Low, int High)> ranges)
    {
        var complement = new List<(int Low, int High)>();
        var cursor = 0;
        foreach (var (low, high) in ranges.OrderBy(range => range.Low))
        {
            if (low > cursor) complement.Add((cursor, low - 1));
            cursor = Math.Max(cursor, high + 1);
        }
        if (cursor <= MaxBmpCodeUnit) complement.Add((cursor, MaxBmpCodeUnit));
        return complement;
    }

    private static string ShorthandClassContent(char escape)
    {
        var ranges = ShorthandRanges[char.ToLowerInvariant(escape)];
        return RenderRanges(char.IsUpper(escape) ? ComplementRanges(ranges) : ranges);
    }

    private static Regex EcmaScriptPattern(string pattern)
    {
        lock (PatternCache)
        {
            if (PatternCache.TryGetValue(pattern, out var cached)) return cached;
            Regex compiled;
            try
            {
                compiled = new Regex(TranslateEcmaScriptPattern(pattern), RegexOptions.CultureInvariant);
            }
            catch (ArgumentException error)
            {
                throw new LearningContractValidatorException($"Unsupported pattern {pattern}", error);
            }
            PatternCache[pattern] = compiled;
            return compiled;
        }
    }

    /// <summary>
    /// Rewrites only the constructs where .NET's regex dialect differs from
    /// ECMAScript. Groups, quantifiers, classes, and ordinary escapes are copied
    /// through because both dialects agree on them; constructs whose meaning
    /// differs and cannot be expressed faithfully are rejected.
    /// </summary>
    private static string TranslateEcmaScriptPattern(string pattern)
    {
        var result = new StringBuilder(pattern.Length);
        var inClass = false;
        var index = 0;
        while (index < pattern.Length)
        {
            var character = pattern[index];
            if (character == '\\')
            {
                if (index + 1 >= pattern.Length)
                    throw new LearningContractValidatorException("Pattern ends with a dangling escape");
                var escape = pattern[index + 1];
                if (escape is 'p' or 'P')
                    throw new LearningContractValidatorException(
                        $"Unsupported ECMAScript escape \\{escape} in pattern");
                if (ShorthandRanges.ContainsKey(char.ToLowerInvariant(escape)) && char.IsAsciiLetter(escape))
                {
                    var content = ShorthandClassContent(escape);
                    result.Append(inClass ? content : $"[{content}]");
                }
                else
                {
                    result.Append(character).Append(escape);
                }
                index += 2;
                continue;
            }
            if (inClass)
            {
                if (character == ']') inClass = false;
                result.Append(character);
                index++;
                continue;
            }
            if (character == '[')
            {
                inClass = true;
                result.Append(character);
                index++;
                if (index < pattern.Length && pattern[index] == '^')
                {
                    result.Append('^');
                    index++;
                }
                if (index < pattern.Length && pattern[index] == ']')
                {
                    result.Append("\\]");
                    index++;
                }
                continue;
            }
            switch (character)
            {
                case '^':
                    result.Append("\\A");
                    break;
                case '$':
                    result.Append("\\z");
                    break;
                case '.':
                    result.Append(JsDot);
                    break;
                case '(' when pattern.AsSpan(index).StartsWith("(?<"):
                    if (!pattern.AsSpan(index).StartsWith("(?<=") && !pattern.AsSpan(index).StartsWith("(?<!"))
                        throw new LearningContractValidatorException(
                            "Named capture groups are not supported in patterns");
                    result.Append(character);
                    break;
                default:
                    result.Append(character);
                    break;
            }
            index++;
        }
        if (inClass) throw new LearningContractValidatorException("Pattern has an unterminated class");
        return result.ToString();
    }

    // ----------------------------------------------------------------------- //
    // JSON pointer selection                                                  //
    // ----------------------------------------------------------------------- //

    private static readonly Regex ArrayIndex = new("^(?:0|[1-9][0-9]*)$", RegexOptions.CultureInvariant);

    private static string DecodePointerSegment(string segment) =>
        // Deliberately mirrors the TypeScript peer's replacement order.
        segment.Replace("~1", "/", StringComparison.Ordinal).Replace("~0", "~", StringComparison.Ordinal);

    private static List<JsonElement> SelectPointerValues(JsonElement root, string pointer)
    {
        if (pointer.Length == 0) return [root];
        if (!pointer.StartsWith('/')) return [];
        var values = new List<JsonElement> { root };
        foreach (var rawSegment in pointer[1..].Split('/'))
        {
            var segment = DecodePointerSegment(rawSegment);
            var next = new List<JsonElement>();
            foreach (var value in values)
            {
                if (segment == "*")
                {
                    if (value.ValueKind == JsonValueKind.Array) next.AddRange(value.EnumerateArray());
                    else if (value.ValueKind == JsonValueKind.Object)
                        next.AddRange(value.EnumerateObject().Select(property => property.Value));
                    continue;
                }
                if (value.ValueKind == JsonValueKind.Array && ArrayIndex.IsMatch(segment))
                {
                    var position = int.Parse(segment, CultureInfo.InvariantCulture);
                    if (position < value.GetArrayLength()) next.Add(value[position]);
                }
                else if (value.ValueKind == JsonValueKind.Object && value.TryGetProperty(segment, out var child))
                {
                    next.Add(child);
                }
            }
            values = next;
        }
        return values;
    }

    // ----------------------------------------------------------------------- //
    // Assertion value normalization and comparison                            //
    // ----------------------------------------------------------------------- //

    private static string AssertionValueKey(JsonElement value) => AssertionValueKey(value, default);

    private static string AssertionValueKey(JsonElement value, JsonElement normalization)
    {
        if (value.ValueKind != JsonValueKind.String || normalization.ValueKind != JsonValueKind.Object)
            return $"{JsTypeOf(value)}:{JsJson(value)}";
        var text = value.GetString()!;
        if (normalization.TryGetProperty("unicode", out var form) && form.ValueKind == JsonValueKind.String)
        {
            text = text.Normalize(form.GetString() == "NFKC" ? NormalizationForm.FormKC : NormalizationForm.FormC);
        }
        if (normalization.TryGetProperty("caseFold", out var caseFold) && caseFold.ValueKind == JsonValueKind.True)
        {
            text = UnicodeDefaultCaseFolding.Fold(text);
        }
        return $"string:{JsJsonString(text)}";
    }

    private enum ComparableKind { None, Number, String, DateTime }

    private readonly record struct Comparable(ComparableKind Kind, double Number, string? Text);

    private static Comparable ComparableValue(JsonElement value, string? valueType)
    {
        if (valueType == "number")
            return IsNumber(value) ? new Comparable(ComparableKind.Number, value.GetDouble(), null) : default;
        if (valueType == "date-time")
        {
            if (value.ValueKind != JsonValueKind.String) return default;
            var text = value.GetString()!;
            return ParseCanonicalDateTime(text) is null
                ? default
                : new Comparable(ComparableKind.DateTime, 0, text);
        }
        if (valueType == "string")
            return value.ValueKind == JsonValueKind.String
                ? new Comparable(ComparableKind.String, 0, value.GetString())
                : default;
        if (IsNumber(value)) return new Comparable(ComparableKind.Number, value.GetDouble(), null);
        return value.ValueKind == JsonValueKind.String
            ? new Comparable(ComparableKind.String, 0, value.GetString())
            : default;
    }

    private static int? CompareComparable(Comparable left, Comparable right)
    {
        if (left.Kind == ComparableKind.DateTime && right.Kind == ComparableKind.DateTime)
            return CompareCanonicalDateTimes(left.Text!, right.Text!);
        if (left.Kind != right.Kind) return null;
        return left.Kind switch
        {
            ComparableKind.Number => left.Number < right.Number ? -1 : left.Number > right.Number ? 1 : 0,
            ComparableKind.String => string.CompareOrdinal(left.Text, right.Text) is var order
                ? order < 0 ? -1 : order > 0 ? 1 : 0
                : 0,
            _ => null,
        };
    }

    private static bool CompareAssertionValues(
        JsonElement left, JsonElement right, string relation, string? valueType, JsonElement normalization)
    {
        if (relation == "equal")
        {
            if (valueType == "date-time" &&
                (ComparableValue(left, valueType).Kind == ComparableKind.None ||
                 ComparableValue(right, valueType).Kind == ComparableKind.None))
                return false;
            return AssertionValueKey(left, normalization) == AssertionValueKey(right, normalization);
        }
        var comparableLeft = ComparableValue(left, valueType);
        var comparableRight = ComparableValue(right, valueType);
        if (comparableLeft.Kind == ComparableKind.None || comparableRight.Kind == ComparableKind.None) return false;
        var comparison = CompareComparable(comparableLeft, comparableRight);
        if (comparison is null) return false;
        return relation == "less-than" ? comparison < 0 : comparison <= 0;
    }

    // ----------------------------------------------------------------------- //
    // Canonical date-time comparison                                          //
    // ----------------------------------------------------------------------- //

    private static readonly Regex CanonicalDateTime = new(
        @"^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.([0-9]+))?)?(Z|([+-])([0-9]{2}):([0-9]{2}))$",
        RegexOptions.CultureInvariant);

    private static readonly int[] MonthDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    private static (long EpochSecond, string FractionalSecond)? ParseCanonicalDateTime(string value)
    {
        var match = CanonicalDateTime.Match(value);
        if (!match.Success) return null;
        var year = int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture);
        var month = int.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture);
        var day = int.Parse(match.Groups[3].Value, CultureInfo.InvariantCulture);
        var hour = int.Parse(match.Groups[4].Value, CultureInfo.InvariantCulture);
        var minute = int.Parse(match.Groups[5].Value, CultureInfo.InvariantCulture);
        var second = match.Groups[6].Success ? int.Parse(match.Groups[6].Value, CultureInfo.InvariantCulture) : 0;
        var offsetHour = match.Groups[10].Success ? int.Parse(match.Groups[10].Value, CultureInfo.InvariantCulture) : 0;
        var offsetMinute = match.Groups[11].Success ? int.Parse(match.Groups[11].Value, CultureInfo.InvariantCulture) : 0;
        if (offsetHour > 23 || offsetMinute > 59) return null;
        if (month is < 1 or > 12 || hour > 23 || minute > 59 || second > 59 || day < 1) return null;
        var leap = month == 2 && year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
        if (day > MonthDays[month - 1] + (leap ? 1 : 0)) return null;
        var direction = match.Groups[9].Value == "-" ? -1 : 1;
        var offsetSeconds = match.Groups[8].Value == "Z"
            ? 0
            : direction * (offsetHour * 3600 + offsetMinute * 60);
        var epochSecond = DaysFromCivil(year, month, day) * 86400L +
            hour * 3600L + minute * 60L + second - offsetSeconds;
        return (epochSecond, match.Groups[7].Success ? match.Groups[7].Value : string.Empty);
    }

    private static long DaysFromCivil(int year, int month, int day)
    {
        var shifted = year - (month <= 2 ? 1 : 0);
        var era = (shifted >= 0 ? shifted : shifted - 399) / 400;
        var yearOfEra = shifted - era * 400;
        var dayOfYear = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1;
        var dayOfEra = yearOfEra * 365L + yearOfEra / 4 - yearOfEra / 100 + dayOfYear;
        return era * 146097L + dayOfEra - 719468L;
    }

    private static int CompareCanonicalDateTimes(string left, string right)
    {
        var leftInstant = ParseCanonicalDateTime(left);
        var rightInstant = ParseCanonicalDateTime(right);
        if (leftInstant is null || rightInstant is null) return 0;
        if (leftInstant.Value.EpochSecond != rightInstant.Value.EpochSecond)
            return leftInstant.Value.EpochSecond < rightInstant.Value.EpochSecond ? -1 : 1;
        var precision = Math.Max(leftInstant.Value.FractionalSecond.Length, rightInstant.Value.FractionalSecond.Length);
        var paddedLeft = leftInstant.Value.FractionalSecond.PadRight(precision, '0');
        var paddedRight = rightInstant.Value.FractionalSecond.PadRight(precision, '0');
        var order = string.CompareOrdinal(paddedLeft, paddedRight);
        return order < 0 ? -1 : order > 0 ? 1 : 0;
    }

    // ----------------------------------------------------------------------- //
    // Bounded JSON trees and the inline-payload key vocabulary                //
    // ----------------------------------------------------------------------- //

    // Unicode's White_Space binary property has no BCL predicate. The set has
    // been stable since Unicode 4.1 and is spelled out so the value can never
    // silently depend on the runtime's Unicode version.
    private static readonly HashSet<int> WhiteSpaceCodePoints =
    [
        0x0009, 0x000A, 0x000B, 0x000C, 0x000D, 0x0020, 0x0085, 0x00A0, 0x1680,
        0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008,
        0x2009, 0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000,
    ];

    /// <summary>
    /// The V1 normalization for attachment metadata field names: NFKC, lowercase,
    /// then drop white space and dash or connector punctuation. Peer of the
    /// TypeScript <c>normalizeInlineAttachmentPayloadKeyV1</c>.
    /// </summary>
    public static string NormalizeInlineAttachmentPayloadKey(string key)
    {
        var lowered = key.Normalize(NormalizationForm.FormKC).ToLowerInvariant();
        var builder = new StringBuilder(lowered.Length);
        foreach (var character in lowered)
        {
            if (WhiteSpaceCodePoints.Contains(character)) continue;
            var category = CharUnicodeInfo.GetUnicodeCategory(character);
            if (category is UnicodeCategory.DashPunctuation or UnicodeCategory.ConnectorPunctuation) continue;
            builder.Append(character);
        }
        return builder.ToString();
    }

    private static int Utf8ByteLength(string value)
    {
        var total = 0;
        for (var index = 0; index < value.Length; index++)
        {
            var codePoint = (int)value[index];
            if (char.IsHighSurrogate(value[index]) && index + 1 < value.Length &&
                char.IsLowSurrogate(value[index + 1]))
            {
                codePoint = char.ConvertToUtf32(value[index], value[index + 1]);
                index++;
            }
            total += codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
        }
        return total;
    }

    private static int JsonStringByteLength(string value)
    {
        var total = 2;
        for (var index = 0; index < value.Length; index++)
        {
            var codeUnit = (int)value[index];
            if (codeUnit is 0x22 or 0x5C) total += 2;
            else if (codeUnit is 0x08 or 0x09 or 0x0A or 0x0C or 0x0D) total += 2;
            else if (codeUnit < 0x20) total += 6;
            else if (codeUnit < 0x80) total += 1;
            else if (codeUnit < 0x800) total += 2;
            else if (char.IsHighSurrogate(value[index]) && index + 1 < value.Length &&
                char.IsLowSurrogate(value[index + 1]))
            {
                total += 4;
                index++;
            }
            else if (codeUnit is >= 0xD800 and <= 0xDFFF) total += 6;
            else total += 3;
        }
        return total;
    }

    private sealed record JsonTreeBounds(
        int MaxSerializedBytes, int MaxDepth, int MaxNodes, int MaxObjectProperties,
        int MaxArrayItems, int MaxStringBytes, int MaxKeyBytes);

    private sealed class BoundsExceededException : Exception;

    /// <summary>
    /// Whether the value satisfies every V1 JSON tree bound. The TypeScript peer
    /// collects issues and stops descending once the node or depth cap is hit;
    /// because the only question asked here is whether that issue list is empty,
    /// returning early on the first violation is exactly equivalent.
    /// </summary>
    private static bool ValidateJsonTreeBounds(JsonElement value, JsonTreeBounds bounds)
    {
        var nodes = 0;
        var serialized = 0L;

        void Visit(JsonElement current, int depth)
        {
            nodes++;
            if (nodes > bounds.MaxNodes || depth > bounds.MaxDepth) throw new BoundsExceededException();
            switch (current.ValueKind)
            {
                case JsonValueKind.String:
                    var text = current.GetString()!;
                    if (Utf8ByteLength(text) > bounds.MaxStringBytes) throw new BoundsExceededException();
                    serialized += JsonStringByteLength(text);
                    return;
                case JsonValueKind.Null:
                    serialized += 4;
                    return;
                case JsonValueKind.True:
                    serialized += 4;
                    return;
                case JsonValueKind.False:
                    serialized += 5;
                    return;
                case JsonValueKind.Number:
                    serialized += JsNumber(current.GetDouble()).Length;
                    return;
                case JsonValueKind.Array:
                    var items = current.GetArrayLength();
                    if (items > bounds.MaxArrayItems) throw new BoundsExceededException();
                    serialized += 2 + Math.Max(0, items - 1);
                    foreach (var item in current.EnumerateArray()) Visit(item, depth + 1);
                    return;
                case JsonValueKind.Object:
                    var properties = current.EnumerateObject().Count();
                    if (properties > bounds.MaxObjectProperties) throw new BoundsExceededException();
                    serialized += 2 + Math.Max(0, properties - 1) + properties;
                    foreach (var property in current.EnumerateObject())
                    {
                        // JSON.parse materializes "__proto__" as an own property,
                        // which the TypeScript peer reports as invalid JSON.
                        if (property.Name == "__proto__") throw new BoundsExceededException();
                        if (Utf8ByteLength(property.Name) > bounds.MaxKeyBytes) throw new BoundsExceededException();
                        serialized += JsonStringByteLength(property.Name);
                        Visit(property.Value, depth + 1);
                    }
                    return;
                default:
                    throw new BoundsExceededException();
            }
        }

        try
        {
            Visit(value, 1);
        }
        catch (BoundsExceededException)
        {
            return false;
        }
        return serialized <= bounds.MaxSerializedBytes;
    }

    private static bool HasForbiddenBoundedJsonKey(JsonElement value, JsonElement assertion)
    {
        if (value.ValueKind == JsonValueKind.Array)
            return value.EnumerateArray().Any(item => HasForbiddenBoundedJsonKey(item, assertion));
        if (value.ValueKind != JsonValueKind.Object) return false;
        var forbidden = StringList(assertion, "forbiddenNormalizedKeys");
        var suffixes = StringList(assertion, "forbiddenNormalizedKeySuffixes");
        var fragments = StringList(assertion, "forbiddenNormalizedKeyFragments");
        foreach (var property in value.EnumerateObject())
        {
            var normalized = NormalizeInlineAttachmentPayloadKey(property.Name);
            if (forbidden.Contains(normalized, StringComparer.Ordinal) ||
                suffixes.Any(suffix => normalized.EndsWith(suffix, StringComparison.Ordinal)) ||
                fragments.Any(fragment => normalized.Contains(fragment, StringComparison.Ordinal)) ||
                HasForbiddenBoundedJsonKey(property.Value, assertion))
                return true;
        }
        return false;
    }

    private static string[] StringList(JsonElement assertion, string name) =>
        assertion.TryGetProperty(name, out var list) && list.ValueKind == JsonValueKind.Array
            ? list.EnumerateArray().Select(entry => entry.GetString()!).ToArray()
            : [];

    // ----------------------------------------------------------------------- //
    // Custom keywords                                                         //
    // ----------------------------------------------------------------------- //

    private static bool ValidateEqualProperties(JsonElement pairs, JsonElement value)
    {
        if (pairs.ValueKind != JsonValueKind.Array) return false;
        foreach (var pair in pairs.EnumerateArray())
        {
            if (pair.ValueKind != JsonValueKind.Array || pair.GetArrayLength() != 2) return false;
            var hasLeft = value.TryGetProperty(pair[0].GetString()!, out var left);
            var hasRight = value.TryGetProperty(pair[1].GetString()!, out var right);
            if (!hasLeft || !hasRight)
            {
                // JavaScript compares two absent properties as undefined === undefined.
                if (hasLeft != hasRight) return false;
                continue;
            }
            if (left.ValueKind is JsonValueKind.Object or JsonValueKind.Array ||
                right.ValueKind is JsonValueKind.Object or JsonValueKind.Array)
            {
                // Strict equality on containers is reference identity, which
                // parsed JSON can only satisfy for the very same node.
                return false;
            }
            if (!JsonEqual(left, right)) return false;
        }
        return true;
    }

    private static bool ValidateAssertions(JsonElement assertions, JsonElement value)
    {
        if (assertions.ValueKind != JsonValueKind.Array) return false;
        foreach (var assertion in assertions.EnumerateArray())
        {
            if (assertion.ValueKind != JsonValueKind.Object) return false;
            if (!assertion.TryGetProperty("operation", out var operation) ||
                operation.ValueKind != JsonValueKind.String)
                throw new LearningContractValidatorException("Assertion is missing an operation");
            if (!ValidateAssertion(operation.GetString()!, assertion, value)) return false;
        }
        return true;
    }

    private static bool ValidateAssertion(string operation, JsonElement assertion, JsonElement value) =>
        operation switch
        {
            "compare" => OpCompare(assertion, value),
            "compare-values" => OpCompareValues(assertion, value),
            "unique" => OpUnique(assertion, value),
            "all-equal" => OpAllEqual(assertion, value),
            "strictly-increasing" => OpStrictlyIncreasing(assertion, value),
            "contiguous" => OpContiguous(assertion, value),
            "values-in-range" => OpValuesInRange(assertion, value),
            "references" => OpReferences(assertion, value),
            "disjoint" => OpDisjoint(assertion, value),
            "ordered-ranges" => OpOrderedRanges(assertion, value),
            "lookup-equal" => OpLookupEqual(assertion, value),
            "lookup-references" => OpLookupReferences(assertion, value),
            "count" => OpCount(assertion, value),
            "utf8-byte-length" => OpUtf8ByteLength(assertion, value),
            "bounded-json" => OpBoundedJson(assertion, value),
            _ => throw new LearningContractValidatorException(
                $"Unsupported assertion operation: {operation}"),
        };

    private static string Pointer(JsonElement assertion, string name) => assertion.GetProperty(name).GetString()!;

    private static string? OptionalText(JsonElement assertion, string name) =>
        assertion.TryGetProperty(name, out var found) && found.ValueKind == JsonValueKind.String
            ? found.GetString()
            : null;

    private static JsonElement Normalization(JsonElement assertion, string name) =>
        assertion.TryGetProperty(name, out var found) ? found : default;

    private static bool Flag(JsonElement assertion, string name) =>
        assertion.TryGetProperty(name, out var found) && found.ValueKind == JsonValueKind.True;

    private static bool OpCompare(JsonElement assertion, JsonElement value)
    {
        var left = SelectPointerValues(value, Pointer(assertion, "left"));
        var right = SelectPointerValues(value, Pointer(assertion, "right"));
        return left.Count == 1 && right.Count == 1 && CompareAssertionValues(
            left[0], right[0], Pointer(assertion, "relation"),
            OptionalText(assertion, "valueType"), Normalization(assertion, "normalization"));
    }

    private static bool OpCompareValues(JsonElement assertion, JsonElement value)
    {
        var right = SelectPointerValues(value, Pointer(assertion, "right"));
        return right.Count == 1 && SelectPointerValues(value, Pointer(assertion, "values")).All(item =>
            CompareAssertionValues(item, right[0], Pointer(assertion, "relation"),
                OptionalText(assertion, "valueType"), default));
    }

    private static bool OpUnique(JsonElement assertion, JsonElement value)
    {
        var normalization = Normalization(assertion, "normalization");
        var keys = SelectPointerValues(value, Pointer(assertion, "values"))
            .Select(item => AssertionValueKey(item, normalization)).ToList();
        return keys.Distinct(StringComparer.Ordinal).Count() == keys.Count;
    }

    private static bool OpAllEqual(JsonElement assertion, JsonElement value)
    {
        var normalization = Normalization(assertion, "normalization");
        return SelectPointerValues(value, Pointer(assertion, "values"))
            .Select(item => AssertionValueKey(item, normalization))
            .Distinct(StringComparer.Ordinal).Count() <= 1;
    }

    private static bool OpStrictlyIncreasing(JsonElement assertion, JsonElement value)
    {
        var valueType = OptionalText(assertion, "valueType");
        var values = SelectPointerValues(value, Pointer(assertion, "values"))
            .Select(item => ComparableValue(item, valueType)).ToList();
        for (var index = 0; index < values.Count; index++)
        {
            if (values[index].Kind == ComparableKind.None) return false;
            if (index > 0 && (values[index - 1].Kind == ComparableKind.None ||
                CompareComparable(values[index], values[index - 1]) != 1))
                return false;
        }
        return true;
    }

    private static bool OpContiguous(JsonElement assertion, JsonElement value)
    {
        var start = assertion.GetProperty("start").GetDouble();
        var values = SelectPointerValues(value, Pointer(assertion, "values"));
        for (var index = 0; index < values.Count; index++)
        {
            if (!IsNumber(values[index]) || values[index].GetDouble() != start + index) return false;
        }
        return true;
    }

    private static bool OpValuesInRange(JsonElement assertion, JsonElement value)
    {
        var valueType = OptionalText(assertion, "valueType");
        var minimumValues = SelectPointerValues(value, Pointer(assertion, "minimum"));
        var maximumValues = SelectPointerValues(value, Pointer(assertion, "maximum"));
        if (minimumValues.Count != 1 || maximumValues.Count != 1) return false;
        var minimum = ComparableValue(minimumValues[0], valueType);
        var maximum = ComparableValue(maximumValues[0], valueType);
        if (minimum.Kind == ComparableKind.None || maximum.Kind == ComparableKind.None) return false;
        var boundsComparison = CompareComparable(minimum, maximum);
        if (boundsComparison is null || boundsComparison > 0) return false;
        var minimumExclusive = Flag(assertion, "minimumExclusive");
        var maximumExclusive = Flag(assertion, "maximumExclusive");
        foreach (var item in SelectPointerValues(value, Pointer(assertion, "values")))
        {
            var comparable = ComparableValue(item, valueType);
            if (comparable.Kind == ComparableKind.None) return false;
            var low = CompareComparable(comparable, minimum);
            var high = CompareComparable(comparable, maximum);
            if (low is null || high is null) return false;
            var above = minimumExclusive ? low > 0 : low >= 0;
            var below = maximumExclusive ? high < 0 : high <= 0;
            if (!above || !below) return false;
        }
        return true;
    }

    private static bool OpReferences(JsonElement assertion, JsonElement value)
    {
        var normalization = Normalization(assertion, "normalization");
        var targets = SelectPointerValues(value, Pointer(assertion, "targets"))
            .Select(item => AssertionValueKey(item, normalization)).ToHashSet(StringComparer.Ordinal);
        return SelectPointerValues(value, Pointer(assertion, "values"))
            .All(item => targets.Contains(AssertionValueKey(item, normalization)));
    }

    private static bool OpDisjoint(JsonElement assertion, JsonElement value)
    {
        var normalization = Normalization(assertion, "normalization");
        var right = SelectPointerValues(value, Pointer(assertion, "right"))
            .Select(item => AssertionValueKey(item, normalization)).ToHashSet(StringComparer.Ordinal);
        return SelectPointerValues(value, Pointer(assertion, "left"))
            .All(item => !right.Contains(AssertionValueKey(item, normalization)));
    }

    private static bool OpOrderedRanges(JsonElement assertion, JsonElement value)
    {
        var valueType = OptionalText(assertion, "valueType");
        Comparable previousLast = default;
        foreach (var range in SelectPointerValues(value, Pointer(assertion, "ranges")))
        {
            var firstValues = SelectPointerValues(range, Pointer(assertion, "first"));
            var lastValues = SelectPointerValues(range, Pointer(assertion, "last"));
            if (firstValues.Count != 1 || lastValues.Count != 1) return false;
            var first = ComparableValue(firstValues[0], valueType);
            var last = ComparableValue(lastValues[0], valueType);
            if (first.Kind == ComparableKind.None || last.Kind == ComparableKind.None) return false;
            var rangeComparison = CompareComparable(first, last);
            if (rangeComparison is null || rangeComparison > 0) return false;
            if (previousLast.Kind != ComparableKind.None)
            {
                var previousComparison = CompareComparable(first, previousLast);
                if (previousComparison is null || previousComparison <= 0) return false;
            }
            previousLast = last;
        }
        return true;
    }

    private static bool MatchesLookupKey(
        JsonElement entry, string keyPointer, JsonElement normalization, string referenceKey)
    {
        var keys = SelectPointerValues(entry, keyPointer);
        return keys.Count == 1 && AssertionValueKey(keys[0], normalization) == referenceKey;
    }

    private static bool OpLookupEqual(JsonElement assertion, JsonElement value)
    {
        var normalization = Normalization(assertion, "normalization");
        var references = SelectPointerValues(value, Pointer(assertion, "reference"));
        var expected = SelectPointerValues(value, Pointer(assertion, "expected"));
        if (references.Count != 1 || expected.Count != 1) return false;
        var referenceKey = AssertionValueKey(references[0], normalization);
        var matches = SelectPointerValues(value, Pointer(assertion, "collection"))
            .Where(entry => MatchesLookupKey(entry, Pointer(assertion, "key"), normalization, referenceKey))
            .ToList();
        if (matches.Count != 1) return false;
        var values = SelectPointerValues(matches[0], Pointer(assertion, "value"));
        return values.Count == 1 &&
            CompareAssertionValues(values[0], expected[0], "equal", null, normalization);
    }

    private static bool OpLookupReferences(JsonElement assertion, JsonElement value)
    {
        var keyNormalization = Normalization(assertion, "keyNormalization");
        var valueNormalization = Normalization(assertion, "valueNormalization");
        var collection = SelectPointerValues(value, Pointer(assertion, "collection"));
        var targetsProperty = assertion.GetProperty("targets");
        var targetPointers = targetsProperty.ValueKind == JsonValueKind.String
            ? [targetsProperty.GetString()!]
            : targetsProperty.EnumerateArray().Select(entry => entry.GetString()!).ToArray();
        foreach (var source in SelectPointerValues(value, Pointer(assertion, "sources")))
        {
            var references = SelectPointerValues(source, Pointer(assertion, "reference"));
            if (references.Count != 1) return false;
            var referenceKey = AssertionValueKey(references[0], keyNormalization);
            var matches = collection
                .Where(entry => MatchesLookupKey(entry, Pointer(assertion, "key"), keyNormalization, referenceKey))
                .ToList();
            if (matches.Count != 1) return false;
            var targets = targetPointers
                .SelectMany(pointer => SelectPointerValues(matches[0], pointer))
                .Select(item => AssertionValueKey(item, valueNormalization))
                .ToHashSet(StringComparer.Ordinal);
            if (SelectPointerValues(source, Pointer(assertion, "values"))
                .Any(item => !targets.Contains(AssertionValueKey(item, valueNormalization))))
                return false;
        }
        return true;
    }

    private static bool OpCount(JsonElement assertion, JsonElement value)
    {
        var normalization = Normalization(assertion, "normalization");
        var hasWhere = assertion.TryGetProperty("where", out var where);
        bool Matches(JsonElement item)
        {
            if (!hasWhere) return true;
            var key = AssertionValueKey(item, normalization);
            if (where.TryGetProperty("equals", out var equals))
                return key == AssertionValueKey(equals, normalization);
            return where.GetProperty("in").EnumerateArray()
                .Any(candidate => key == AssertionValueKey(candidate, normalization));
        }

        var count = SelectPointerValues(value, Pointer(assertion, "values")).Count(Matches);
        if (assertion.TryGetProperty("exactly", out var exactly) && count != exactly.GetInt32()) return false;
        if (assertion.TryGetProperty("minimum", out var minimum) && count < minimum.GetInt32()) return false;
        return !assertion.TryGetProperty("maximum", out var maximum) || count <= maximum.GetInt32();
    }

    private static bool OpUtf8ByteLength(JsonElement assertion, JsonElement value)
    {
        var maximum = assertion.GetProperty("maximum").GetInt32();
        return SelectPointerValues(value, Pointer(assertion, "values")).All(item =>
            item.ValueKind == JsonValueKind.Null ||
            (item.ValueKind == JsonValueKind.String && Utf8ByteLength(item.GetString()!) <= maximum));
    }

    private static bool OpBoundedJson(JsonElement assertion, JsonElement value)
    {
        var bounds = new JsonTreeBounds(
            assertion.GetProperty("serializedMaximum").GetInt32(),
            assertion.GetProperty("maximumDepth").GetInt32(),
            assertion.GetProperty("maximumNodes").GetInt32(),
            assertion.GetProperty("maximumObjectProperties").GetInt32(),
            assertion.GetProperty("maximumArrayItems").GetInt32(),
            assertion.GetProperty("maximumStringUtf8Bytes").GetInt32(),
            assertion.GetProperty("maximumKeyUtf8Bytes").GetInt32());
        foreach (var item in SelectPointerValues(value, Pointer(assertion, "values")))
        {
            if (item.ValueKind == JsonValueKind.Null) continue;
            if (item.ValueKind != JsonValueKind.Object) return false;
            if (!ValidateJsonTreeBounds(item, bounds) || HasForbiddenBoundedJsonKey(item, assertion)) return false;
        }
        return true;
    }
}
