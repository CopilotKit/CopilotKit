using System.Collections.Frozen;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace CopilotKit.Intelligence;

/// <summary>The state of a Runtime entitlement lookup.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<RuntimeEntitlementStatus>))]
public enum RuntimeEntitlementStatus
{
    /// <summary>The platform returned a grant.</summary>
    [JsonStringEnumMemberName("ready")] Ready,
    /// <summary>The platform returned a degraded state.</summary>
    [JsonStringEnumMemberName("degraded")] Degraded,
    /// <summary>The project configuration requires a change.</summary>
    [JsonStringEnumMemberName("misconfigured")] Misconfigured,
    /// <summary>The entitlement is unavailable.</summary>
    [JsonStringEnumMemberName("unavailable")] Unavailable
}

/// <summary>The source of a Runtime grant.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<RuntimeEntitlementSource>))]
public enum RuntimeEntitlementSource
{
    /// <summary>A managed organization subscription.</summary>
    [JsonStringEnumMemberName("managedOrgSubscription")] ManagedOrgSubscription,
    /// <summary>A self-hosted deployment license.</summary>
    [JsonStringEnumMemberName("selfHostedDeploymentLicense")] SelfHostedDeploymentLicense,
    /// <summary>An AWS Marketplace deployment license.</summary>
    [JsonStringEnumMemberName("awsMarketplaceDeploymentLicense")] AwsMarketplaceDeploymentLicense
}

/// <summary>A Runtime grant with project features and limits.</summary>
public sealed record RuntimeEntitlement(
    [property: JsonPropertyName("active")] bool Active,
    [property: JsonPropertyName("source")] RuntimeEntitlementSource Source,
    [property: JsonPropertyName("features")] IReadOnlyDictionary<string, bool> Features,
    [property: JsonPropertyName("limits")] IReadOnlyDictionary<string, double> Limits,
    [property: JsonPropertyName("planCode"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? PlanCode = null,
    [property: JsonPropertyName("entitlementSource"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? EntitlementSource = null);

/// <summary>A structured problem returned by the platform.</summary>
public sealed record RuntimeEntitlementProblem(
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("retryable")] bool Retryable,
    [property: JsonPropertyName("requestId"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? RequestId = null,
    [property: JsonPropertyName("traceId"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? TraceId = null);

/// <summary>A ready response contains Entitlement; other states contain Error.</summary>
public sealed record RuntimeEntitlementResponse(
    [property: JsonPropertyName("status")] RuntimeEntitlementStatus Status,
    [property: JsonPropertyName("entitlement"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] RuntimeEntitlement? Entitlement = null,
    [property: JsonPropertyName("error"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] RuntimeEntitlementProblem? Error = null);

/// <summary>A lookup failure with no private response body or transport details.</summary>
public sealed class RuntimeEntitlementException(int statusCode, bool retryable) : IntelligenceException(statusCode, "Runtime entitlement request failed")
{
    /// <summary>Whether the request can recover without a configuration change.</summary>
    public bool Retryable { get; } = retryable;
}

public sealed partial class IntelligenceClient
{
    /// <summary>Bounds the full response and closes rejected bodies without a read.</summary>
    private async Task<RuntimeEntitlementResponse> FetchRuntimeEntitlementsAsync(CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(options.RequestTimeout < TimeSpan.FromSeconds(1.5) ? options.RequestTimeout : TimeSpan.FromSeconds(1.5));
        using var request = new HttpRequestMessage(HttpMethod.Get, options.ApiUrl.ToString().TrimEnd('/') + "/api/entitlements/runtime");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", options.ApiKey);
        try
        {
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            if (!response.IsSuccessStatusCode)
            {
                var status = (int)response.StatusCode;
                throw new RuntimeEntitlementException(status, status is 408 or 425 or 429 || status >= 500);
            }
            const int maxBytes = 16 * 1024 * 1024;
            if (response.Content.Headers.ContentLength > maxBytes) throw MalformedEntitlement();
            await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
            using var bytes = new MemoryStream();
            var buffer = new byte[8192];
            int count;
            while ((count = await stream.ReadAsync(buffer, timeout.Token)) > 0)
            {
                if (bytes.Length + count > maxBytes) throw MalformedEntitlement();
                bytes.Write(buffer, 0, count);
            }
            using var document = JsonDocument.Parse(bytes.GetBuffer().AsMemory(0, (int)bytes.Length));
            return ParseRuntimeEntitlements(document.RootElement);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (OperationCanceledException) { throw new RuntimeEntitlementException(504, true); }
        catch (RuntimeEntitlementException error) { throw new RuntimeEntitlementException(error.StatusCode, error.Retryable); }
        catch (JsonException) { throw new RuntimeEntitlementException(502, false); }
        catch (Exception) { throw new RuntimeEntitlementException(502, true); }
    }

    /// <summary>Validates the published union and the legacy flat grant.</summary>
    private static RuntimeEntitlementResponse ParseRuntimeEntitlements(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object) throw MalformedEntitlement();
        if (!value.TryGetProperty("status", out _))
            return new(RuntimeEntitlementStatus.Ready, ParseRuntimeGrant(value, legacy: true));
        var status = EntitlementString(value, "status");
        if (status == "ready")
        {
            EntitlementFields(value, ["status", "entitlement"], []);
            return new(RuntimeEntitlementStatus.Ready, ParseRuntimeGrant(value.GetProperty("entitlement")));
        }
        var parsedStatus = status switch
        {
            "degraded" => RuntimeEntitlementStatus.Degraded,
            "misconfigured" => RuntimeEntitlementStatus.Misconfigured,
            "unavailable" => RuntimeEntitlementStatus.Unavailable,
            _ => throw MalformedEntitlement()
        };
        EntitlementFields(value, ["status", "error"], []);
        var problem = value.GetProperty("error");
        EntitlementFields(problem, ["code", "message", "retryable"], ["requestId", "traceId"]);
        return new(parsedStatus, Error: new RuntimeEntitlementProblem(
            EntitlementString(problem, "code"), EntitlementString(problem, "message"),
            EntitlementBoolean(problem.GetProperty("retryable")), EntitlementOptionalString(problem, "requestId"), EntitlementOptionalString(problem, "traceId")));
    }

    /// <summary>Builds an immutable grant after checking every authority field.</summary>
    private static RuntimeEntitlement ParseRuntimeGrant(JsonElement value, bool legacy = false)
    {
        EntitlementFields(value, legacy ? ["active", "source", "features", "limits", "organizationId"] : ["active", "source", "features", "limits"], ["planCode", "entitlementSource"]);
        if (legacy) _ = EntitlementString(value, "organizationId");
        var source = EntitlementString(value, "source") switch
        {
            "managedOrgSubscription" => RuntimeEntitlementSource.ManagedOrgSubscription,
            "selfHostedDeploymentLicense" => RuntimeEntitlementSource.SelfHostedDeploymentLicense,
            "awsMarketplaceDeploymentLicense" => RuntimeEntitlementSource.AwsMarketplaceDeploymentLicense,
            _ => throw MalformedEntitlement()
        };
        var features = value.GetProperty("features");
        var limits = value.GetProperty("limits");
        if (features.ValueKind != JsonValueKind.Object || limits.ValueKind != JsonValueKind.Object) throw MalformedEntitlement();
        var parsedFeatures = new Dictionary<string, bool>(StringComparer.Ordinal);
        foreach (var property in features.EnumerateObject()) parsedFeatures[property.Name] = EntitlementBoolean(property.Value);
        var parsedLimits = new Dictionary<string, double>(StringComparer.Ordinal);
        foreach (var property in limits.EnumerateObject())
        {
            if (property.Value.ValueKind != JsonValueKind.Number || !property.Value.TryGetDouble(out var number) || !double.IsFinite(number)) throw MalformedEntitlement();
            parsedLimits[property.Name] = number;
        }
        return new(EntitlementBoolean(value.GetProperty("active")), source,
            parsedFeatures.ToFrozenDictionary(StringComparer.Ordinal), parsedLimits.ToFrozenDictionary(StringComparer.Ordinal),
            EntitlementOptionalString(value, "planCode"), EntitlementOptionalString(value, "entitlementSource"));
    }

    /// <summary>Rejects missing and unknown fields at an authority boundary.</summary>
    private static void EntitlementFields(JsonElement value, string[] required, string[] optional)
    {
        if (value.ValueKind != JsonValueKind.Object) throw MalformedEntitlement();
        foreach (var field in required) if (!value.TryGetProperty(field, out _)) throw MalformedEntitlement();
        foreach (var property in value.EnumerateObject())
            if (!required.Contains(property.Name, StringComparer.Ordinal) && !optional.Contains(property.Name, StringComparer.Ordinal)) throw MalformedEntitlement();
    }

    /// <summary>Reads a required string without coercion.</summary>
    private static string EntitlementString(JsonElement value, string name)
    {
        if (!value.TryGetProperty(name, out var text) || text.ValueKind != JsonValueKind.String) throw MalformedEntitlement();
        return text.GetString()!;
    }

    /// <summary>Distinguishes an absent string from a null value.</summary>
    private static string? EntitlementOptionalString(JsonElement value, string name) => value.TryGetProperty(name, out _) ? EntitlementString(value, name) : null;

    /// <summary>Reads a boolean without treating null as false.</summary>
    private static bool EntitlementBoolean(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.True => true, JsonValueKind.False => false, _ => throw MalformedEntitlement()
    };

    /// <summary>Creates a safe, nonretryable schema failure.</summary>
    private static RuntimeEntitlementException MalformedEntitlement() => new(502, false);
}
