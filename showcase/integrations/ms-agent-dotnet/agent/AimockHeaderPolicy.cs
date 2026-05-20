// STOPGAP: This integration-level header propagation replaces once copilotkit-sdk-dotnet
// ships (Microsoft contribution, ETA mid-2026). When that SDK lands, delete this code
// and use the SDK's built-in header propagation.
// See: https://www.notion.so/copilotkit/3543aa3818528150b6acc5b872ad7fe5

using System.ClientModel.Primitives;
using OpenAI;

// TODO(copilotkit-sdk-dotnet): migrate to SDK-level header propagation
public class AimockHeaderPolicy : PipelinePolicy
{
    public override void Process(PipelineMessage message, IReadOnlyList<PipelinePolicy> pipeline, int currentIndex)
    {
        foreach (var header in AimockHeaderContext.Get())
            message.Request.Headers.Set(header.Key, header.Value);
        ProcessNext(message, pipeline, currentIndex);
    }

    public override async ValueTask ProcessAsync(PipelineMessage message, IReadOnlyList<PipelinePolicy> pipeline, int currentIndex)
    {
        foreach (var header in AimockHeaderContext.Get())
            message.Request.Headers.Set(header.Key, header.Value);
        await ProcessNextAsync(message, pipeline, currentIndex);
    }

    /// <summary>
    /// Creates an <see cref="OpenAIClientOptions"/> with the header forwarding policy
    /// pre-configured. All OpenAI client instantiations should use this to ensure
    /// x-* prefixed headers propagate to outgoing calls.
    /// </summary>
    // TODO(copilotkit-sdk-dotnet): migrate to SDK-level header propagation
    public static OpenAIClientOptions CreateOpenAIClientOptions(string endpoint)
    {
        var options = new OpenAIClientOptions
        {
            Endpoint = new Uri(endpoint),
        };
        options.AddPolicy(new AimockHeaderPolicy(), PipelinePosition.PerCall);
        return options;
    }
}
