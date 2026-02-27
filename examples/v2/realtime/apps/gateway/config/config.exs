import Config

config :realtime_gateway, GatewayWeb.Endpoint,
  url: [host: "localhost"],
  render_errors: [formats: [json: GatewayWeb.ErrorJSON], layout: false],
  pubsub_server: Gateway.PubSub,
  server: true,
  http: [ip: {0, 0, 0, 0}, port: 4200],
  secret_key_base:
    "realtime-gateway-dev-secret-key-base-change-me-000000000000000000"

config :realtime_gateway, Gateway.PubSub,
  adapter: Phoenix.PubSub.Redis,
  node_name: "gateway",
  redis_url: "redis://localhost:6379"

config :phoenix, :json_library, Jason
