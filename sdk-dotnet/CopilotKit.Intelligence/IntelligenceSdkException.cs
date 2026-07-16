namespace CopilotKit.Intelligence;

public enum IntelligenceErrorCode
{
    CacheCorrupt,
    BlobIntegrityFailure,
    RegistryUnrecoverable,
}

public static class IntelligenceErrorCodes
{
    public const string CacheCorrupt = "LEARNING_SDK_CACHE_CORRUPT";
    public const string BlobIntegrityFailure = "LEARNING_BLOB_INTEGRITY_FAILURE";
    public const string RegistryUnrecoverable = "LEARNING_REGISTRY_UNRECOVERABLE";
}

public sealed class IntelligenceSdkException : Exception
{
    public IntelligenceSdkException(
        string message,
        IntelligenceErrorCode code,
        string category,
        bool retryable,
        int? status = null,
        string? requestId = null,
        string? traceId = null,
        Exception? innerException = null)
        : this(message, ToCanonicalCode(code), category, retryable, status, requestId, traceId, innerException)
    {
    }

    public IntelligenceSdkException(
        string message,
        string code,
        string category,
        bool retryable,
        int? status = null,
        string? requestId = null,
        string? traceId = null,
        Exception? innerException = null)
        : base(message, innerException)
    {
        Code = code;
        Category = category;
        Retryable = retryable;
        Status = status;
        RequestId = requestId;
        TraceId = traceId;
    }

    public string Code { get; }
    public string Category { get; }
    public bool Retryable { get; }
    public int? Status { get; }
    public string? RequestId { get; }
    public string? TraceId { get; }

    private static string ToCanonicalCode(IntelligenceErrorCode code) => code switch
    {
        IntelligenceErrorCode.CacheCorrupt => IntelligenceErrorCodes.CacheCorrupt,
        IntelligenceErrorCode.BlobIntegrityFailure => IntelligenceErrorCodes.BlobIntegrityFailure,
        IntelligenceErrorCode.RegistryUnrecoverable => IntelligenceErrorCodes.RegistryUnrecoverable,
        _ => throw new ArgumentOutOfRangeException(nameof(code)),
    };
}
