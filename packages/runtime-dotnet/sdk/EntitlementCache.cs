namespace CopilotKit.Intelligence;

public sealed partial class IntelligenceClient
{
    private readonly object entitlementGate = new();
    private EntitlementCache? entitlementCache;
    private EntitlementFlight? entitlementFlight;
    internal TimeProvider EntitlementClock { get; init; } = TimeProvider.System;

    /// <summary>Reads typed Runtime entitlements without mounting Runtime routes.</summary>
    /// <remarks>Concurrent callers share one request and cancel independently. Active grants cache
    /// for 30 seconds; other results and failures cache for five seconds. Results contain immutable maps.</remarks>
    public async Task<RuntimeEntitlementResponse> GetRuntimeEntitlementsAsync(CancellationToken cancellationToken = default)
    {
        EnsureActive();
        cancellationToken.ThrowIfCancellationRequested();
        EntitlementFlight flight;
        bool start;
        lock (entitlementGate)
        {
            EnsureActive();
            if (entitlementCache is { } cached && EntitlementClock.GetElapsedTime(cached.Timestamp) < cached.Lifetime)
                return cached.Read();
            start = entitlementFlight is null;
            flight = entitlementFlight ??= new EntitlementFlight();
            flight.Waiters++;
        }
        if (start) _ = ResolveRuntimeEntitlementsAsync(flight);
        try
        {
            var result = await flight.Completion.Task.WaitAsync(cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            return result.Read();
        }
        finally
        {
            lock (entitlementGate)
            {
                flight.Waiters--;
                if (flight.Waiters == 0 && ReferenceEquals(entitlementFlight, flight))
                {
                    entitlementFlight = null;
                    flight.Cancellation.Cancel();
                }
            }
        }
    }

    /// <summary>Completes one lookup and caches only a result that still has callers.</summary>
    private async Task ResolveRuntimeEntitlementsAsync(EntitlementFlight flight)
    {
        EntitlementCache? result = null;
        try
        {
            var response = await FetchRuntimeEntitlementsAsync(flight.Cancellation.Token).ConfigureAwait(false);
            result = new(response, null, EntitlementClock.GetTimestamp(), response.Entitlement?.Active == true ? TimeSpan.FromSeconds(30) : TimeSpan.FromSeconds(5));
        }
        catch (RuntimeEntitlementException error)
        {
            result = new(null, new RuntimeEntitlementException(error.StatusCode, error.Retryable), EntitlementClock.GetTimestamp(), TimeSpan.FromSeconds(5));
        }
        catch (OperationCanceledException) { }
        finally
        {
            lock (entitlementGate)
            {
                if (ReferenceEquals(entitlementFlight, flight))
                {
                    entitlementFlight = null;
                    entitlementCache = result;
                }
                if (result is null) flight.Completion.TrySetCanceled();
                else flight.Completion.TrySetResult(result);
            }
            flight.Cancellation.Dispose();
        }
    }

    private sealed class EntitlementFlight
    {
        internal CancellationTokenSource Cancellation { get; } = new();
        internal TaskCompletionSource<EntitlementCache> Completion { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal int Waiters;
    }

    private sealed record EntitlementCache(RuntimeEntitlementResponse? Response, RuntimeEntitlementException? Failure, long Timestamp, TimeSpan Lifetime)
    {
        /// <summary>Returns a caller-owned record or exception with no shared mutable state.</summary>
        internal RuntimeEntitlementResponse Read()
        {
            if (Failure is not null) throw new RuntimeEntitlementException(Failure.StatusCode, Failure.Retryable);
            return Response! with
            {
                Entitlement = Response.Entitlement is { } grant ? grant with { } : null,
                Error = Response.Error is { } problem ? problem with { } : null
            };
        }
    }
}
