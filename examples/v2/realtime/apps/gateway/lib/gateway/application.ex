defmodule Gateway.Application do
  use Application

  @impl true
  def start(_type, _args) do
    children = [
      {Gateway.Redis, redis_url()},
      %{
        id: Gateway.RedixPubSub,
        start: {Redix.PubSub, :start_link, [redis_url(), [name: Gateway.RedixPubSub]]}
      },
      Gateway.RedisBridge,
      {Phoenix.PubSub, name: Gateway.PubSub},
      GatewayWeb.Endpoint
    ]

    opts = [strategy: :one_for_one, name: Gateway.Supervisor]
    Supervisor.start_link(children, opts)
  end

  @impl true
  def config_change(changed, _new, removed) do
    GatewayWeb.Endpoint.config_change(changed, removed)
    :ok
  end

  defp redis_url, do: System.get_env("REDIS_URL") || "redis://localhost:6379"
end
