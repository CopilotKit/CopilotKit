import Config

if config_env() == :prod do
  port = String.to_integer(System.get_env("GATEWAY_PORT") || "4200")
  redis_url = System.get_env("REDIS_URL") || "redis://localhost:6379"

  config :realtime_gateway, GatewayWeb.Endpoint,
    http: [ip: {0, 0, 0, 0}, port: port],
    server: true

  config :realtime_gateway, Gateway.PubSub,
    redis_url: redis_url
end
