using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace CopilotKit.Intelligence;

/// <summary>Display metadata for Inspector. Optional modules are independent.</summary>
public sealed record InspectorMetadata
{
    /// <summary>The supported metadata schema version.</summary>
    [JsonPropertyName("schemaVersion")]
    public int SchemaVersion => 1;
    /// <summary>The organization and project display names.</summary>
    [JsonPropertyName("identity"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public InspectorIdentity? Identity { get; init; }
    /// <summary>The plan display details.</summary>
    [JsonPropertyName("plan"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public InspectorPlan? Plan { get; init; }
    /// <summary>The license display state, not an authorization grant.</summary>
    [JsonPropertyName("license"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public InspectorLicense? License { get; init; }
    /// <summary>A safe link to the next account action.</summary>
    [JsonPropertyName("action"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public InspectorAction? Action { get; init; }
    /// <summary>The usage display values.</summary>
    [JsonPropertyName("usage"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public InspectorUsage? Usage { get; init; }
}

/// <summary>The organization and project display names.</summary>
public sealed record InspectorIdentity(
    [property: JsonPropertyName("organizationName")] string OrganizationName,
    [property: JsonPropertyName("projectName")] string ProjectName);
/// <summary>The plan code and display label.</summary>
public sealed record InspectorPlan(
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("label")] string Label);
/// <summary>The license display state.</summary>
public sealed record InspectorLicense([property: JsonPropertyName("state")] InspectorLicenseState State);
/// <summary>A link for an account action.</summary>
public sealed record InspectorAction(
    [property: JsonPropertyName("kind")] InspectorActionKind Kind,
    [property: JsonPropertyName("url")] string Url);
/// <summary>A usage count and its limit. A null expiry count means unknown.</summary>
public sealed record InspectorUsage(
    [property: JsonPropertyName("used")] long Used,
    [property: JsonPropertyName("limit")] InspectorUsageLimit Limit,
    [property: JsonPropertyName("expiringSoonCount"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? ExpiringSoonCount = null);
/// <summary>A finite, unlimited, or unknown usage limit.</summary>
public sealed record InspectorUsageLimit(
    [property: JsonPropertyName("kind")] InspectorLimitKind Kind,
    [property: JsonPropertyName("value"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? Value = null);

/// <summary>The license states that Inspector can show.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<InspectorLicenseState>))]
public enum InspectorLicenseState
{
    /// <summary>The license is valid.</summary>
    [JsonStringEnumMemberName("valid")] Valid,
    /// <summary>No license is present.</summary>
    [JsonStringEnumMemberName("none")] None,
    /// <summary>The license expired.</summary>
    [JsonStringEnumMemberName("expired")] Expired,
    /// <summary>The license state is unknown.</summary>
    [JsonStringEnumMemberName("unknown")] Unknown
}
/// <summary>The account actions that Inspector can show.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<InspectorActionKind>))]
public enum InspectorActionKind
{
    /// <summary>Manage the current plan.</summary>
    [JsonStringEnumMemberName("manage_plan")] ManagePlan,
    /// <summary>Renew the license.</summary>
    [JsonStringEnumMemberName("renew")] Renew,
    /// <summary>Enable Intelligence.</summary>
    [JsonStringEnumMemberName("enable_intelligence")] EnableIntelligence
}
/// <summary>The supported usage limit kinds.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<InspectorLimitKind>))]
public enum InspectorLimitKind
{
    /// <summary>A positive limit is known.</summary>
    [JsonStringEnumMemberName("finite")] Finite,
    /// <summary>Usage has no limit.</summary>
    [JsonStringEnumMemberName("unlimited")] Unlimited,
    /// <summary>The limit is unknown.</summary>
    [JsonStringEnumMemberName("unknown")] Unknown
}

public sealed partial class IntelligenceClient
{
    /// <summary>Reads sanitized Inspector display metadata without an HTTP host. Unsupported schemas return null.</summary>
    public async Task<InspectorMetadata?> GetInspectorMetadataAsync(CancellationToken cancellationToken = default)
        => ParseInspectorMetadata(await RequestAsync(HttpMethod.Get, "/api/inspector/metadata", cancellationToken: cancellationToken, inspectorMetadata: true));

    internal static InspectorMetadata? ParseInspectorMetadata(JsonNode? node)
    {
        if (node is not JsonObject root || Number(root["schemaVersion"]) != 1) return null;
        InspectorIdentity? identity = null;
        if (root["identity"] is JsonObject i && Text(i["organizationName"]) is { } organization && Text(i["projectName"]) is { } project)
            identity = new(organization, project);
        InspectorPlan? plan = null;
        if (root["plan"] is JsonObject p && Text(p["code"]) is { } code && Text(p["label"]) is { } label)
            plan = new(code, label);
        InspectorLicense? license = null;
        if (root["license"] is JsonObject l)
        {
            InspectorLicenseState? state = RawText(l["state"]) switch
            {
                "valid" => InspectorLicenseState.Valid, "none" => InspectorLicenseState.None,
                "expired" => InspectorLicenseState.Expired, "unknown" => InspectorLicenseState.Unknown, _ => null
            };
            if (state is { } valid) license = new(valid);
        }
        InspectorAction? action = null;
        if (root["action"] is JsonObject a)
        {
            InspectorActionKind? kind = RawText(a["kind"]) switch
            {
                "manage_plan" => InspectorActionKind.ManagePlan, "renew" => InspectorActionKind.Renew,
                "enable_intelligence" => InspectorActionKind.EnableIntelligence, _ => null
            };
            if (kind is { } valid && SafeActionUrl(a["url"]) is { } url) action = new(valid, url);
        }
        InspectorUsage? usage = null;
        if (root["usage"] is JsonObject u && Number(u["used"]) is { } used && u["limit"] is JsonObject limit)
        {
            InspectorUsageLimit? parsed = RawText(limit["kind"]) switch
            {
                "finite" when Number(limit["value"]) is > 0 => new(InspectorLimitKind.Finite, Number(limit["value"])),
                "unlimited" => new(InspectorLimitKind.Unlimited), "unknown" => new(InspectorLimitKind.Unknown), _ => null
            };
            if (parsed is not null) usage = new(used, parsed, Number(u["expiringSoonCount"]));
        }
        return new() { Identity = identity, Plan = plan, License = license, Action = action, Usage = usage };
    }

    private static string? RawText(JsonNode? value)
        => value is JsonValue v && v.TryGetValue<string>(out var text) ? text : null;

    private static string? Text(JsonNode? value)
    {
        // Match ECMAScript trim, including BOM and excluding NEL.
        var text = RawText(value)?.Trim('\u0009', '\u000a', '\u000b', '\u000c', '\u000d', '\u0020', '\u00a0', '\u1680',
            '\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005', '\u2006', '\u2007', '\u2008', '\u2009', '\u200a',
            '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff');
        return string.IsNullOrEmpty(text) ? null : text;
    }

    private static long? Number(JsonNode? node)
        => node is JsonValue value && value.TryGetValue<double>(out var number)
            && double.IsFinite(number) && number >= 0 && number <= 9007199254740991 && Math.Truncate(number) == number
            ? (long)number : null;

    private static string? SafeActionUrl(JsonNode? node)
    {
        var text = Text(node);
        if (text is null || text.Contains('?') || text.Contains('#')) return null;
        var start = text.IndexOf("://", StringComparison.Ordinal);
        if (start < 1) return null;
        var authority = text[(start + 3)..].Split('/')[0];
        if (authority.Contains('@') || !Uri.TryCreate(text, UriKind.Absolute, out var uri)
            || string.IsNullOrEmpty(uri.Host) || !string.IsNullOrEmpty(uri.UserInfo)) return null;
        return uri.Scheme == "https" || (uri.Scheme == "http" && uri.Host is "localhost" or "127.0.0.1" or "[::1]") ? text : null;
    }
}
