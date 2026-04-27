using System.ClientModel;
using System.ComponentModel;
using System.Text.Json;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging;
using OpenAI;

/// <summary>
/// Factory for the A2UI — Fixed Schema agent.
///
/// Mirrors the LangGraph `src/agents/a2ui_fixed.py` reference: the frontend
/// owns a pre-authored component tree (see
/// `src/app/demos/a2ui-fixed-schema/a2ui/definitions.ts` + flight_schema.json)
/// and the agent only streams *data* into the data model via a dedicated
/// `search_flights` tool that emits an <c>a2ui_operations</c> container.
/// The A2UI middleware detects that container in the tool result and
/// forwards rendered surfaces to the frontend.
/// </summary>
public class A2uiFixedSchemaAgent
{
    private const string DefaultOpenAiEndpoint = "https://models.inference.ai.azure.com";
    private const string CatalogId = "copilotkit://flight-fixed-catalog";
    private const string SurfaceId = "flight-fixed-schema";

    private readonly OpenAIClient _openAiClient;
    private readonly ILogger _logger;
    private readonly JsonSerializerOptions _jsonSerializerOptions;

    public A2uiFixedSchemaAgent(IConfiguration configuration, ILoggerFactory loggerFactory, JsonSerializerOptions jsonSerializerOptions)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(loggerFactory);
        ArgumentNullException.ThrowIfNull(jsonSerializerOptions);

        _logger = loggerFactory.CreateLogger<A2uiFixedSchemaAgent>();
        _jsonSerializerOptions = jsonSerializerOptions;

        var githubToken = configuration["GitHubToken"]
            ?? throw new InvalidOperationException(
                "GitHubToken not found in configuration. " +
                "Please set it using: dotnet user-secrets set GitHubToken \"<your-token>\" " +
                "or get it using: gh auth token");

        var endpointEnv = Environment.GetEnvironmentVariable("OPENAI_BASE_URL");
        var endpoint = endpointEnv ?? DefaultOpenAiEndpoint;

        _openAiClient = new(
            new ApiKeyCredential(githubToken),
            new OpenAIClientOptions
            {
                Endpoint = new Uri(endpoint),
            });
    }

    public AIAgent Create()
    {
        var chatClient = _openAiClient.GetChatClient("gpt-4o-mini").AsIChatClient();

        return new ChatClientAgent(
            chatClient,
            name: "A2uiFixedSchemaAgent",
            description: @"You help users find flights. When asked about a flight, call
`search_flights` with origin, destination, airline, and price.
Use short airport codes (e.g. ""SFO"", ""JFK"") for origin/destination and a price
string like ""$289"". Keep any chat reply to one short sentence.",
            tools: [
                AIFunctionFactory.Create(SearchFlights, options: new() { Name = "search_flights", SerializerOptions = _jsonSerializerOptions })
            ]);
    }

    // The fixed-schema flight component tree. Frontend renders this via a
    // registered catalog (`copilotkit://flight-fixed-catalog`). Matches the
    // LangGraph reference at src/agents/a2ui_schemas/flight_schema.json.
    private static readonly object[] FlightSchema = new object[]
    {
        new { id = "root", component = "Card", child = "content" },
        new { id = "content", component = "Column", children = new[] { "title", "route", "meta", "bookButton" } },
        new { id = "title", component = "Title", text = "Flight Details" },
        new
        {
            id = "route",
            component = "Row",
            justify = "spaceBetween",
            align = "center",
            children = new[] { "from", "arrow", "to" },
        },
        new { id = "from", component = "Airport", code = new { path = "/origin" } },
        new { id = "arrow", component = "Arrow" },
        new { id = "to", component = "Airport", code = new { path = "/destination" } },
        new
        {
            id = "meta",
            component = "Row",
            justify = "spaceBetween",
            align = "center",
            children = new[] { "airline", "price" },
        },
        new { id = "airline", component = "AirlineBadge", name = new { path = "/airline" } },
        new { id = "price", component = "PriceTag", amount = new { path = "/price" } },
        new
        {
            id = "bookButton",
            component = "Button",
            variant = "primary",
            child = "bookButtonLabel",
            action = new
            {
                @event = new
                {
                    name = "book_flight",
                    context = new
                    {
                        origin = new { path = "/origin" },
                        destination = new { path = "/destination" },
                        airline = new { path = "/airline" },
                        price = new { path = "/price" },
                    },
                },
            },
        },
        new { id = "bookButtonLabel", component = "Text", text = "Book flight" },
    };

    [Description("Show a flight card for the given trip. Use short airport codes (e.g. SFO, JFK) for origin/destination and a price string like $289.")]
    private string SearchFlights(
        [Description("Origin airport code (e.g. SFO)")] string origin,
        [Description("Destination airport code (e.g. JFK)")] string destination,
        [Description("Airline name")] string airline,
        [Description("Price string (e.g. $289)")] string price)
    {
        _logger.LogInformation("FixedSchema SearchFlights: {Origin} -> {Destination} on {Airline} at {Price}", origin, destination, airline, price);

        var operations = new object[]
        {
            new { type = "create_surface", surfaceId = SurfaceId, catalogId = CatalogId },
            new { type = "update_components", surfaceId = SurfaceId, components = FlightSchema },
            new
            {
                type = "update_data_model",
                surfaceId = SurfaceId,
                data = new
                {
                    origin,
                    destination,
                    airline,
                    price,
                },
            },
        };

        return JsonSerializer.Serialize(new { a2ui_operations = operations });
    }
}
