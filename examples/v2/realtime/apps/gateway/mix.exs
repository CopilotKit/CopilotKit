defmodule Gateway.MixProject do
  use Mix.Project

  def project do
    [
      app: :realtime_gateway,
      version: "0.1.0",
      config_path: "config/config.exs",
      elixir: "~> 1.15",
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      aliases: aliases()
    ]
  end

  def application do
    [
      mod: {Gateway.Application, []},
      extra_applications: [:logger, :runtime_tools]
    ]
  end

  defp deps do
    [
      {:phoenix, "~> 1.7.14"},
      {:phoenix_pubsub, "~> 2.1"},
      {:phoenix_pubsub_redis, "~> 3.0"},
      {:plug_cowboy, "~> 2.7"},
      {:jason, "~> 1.4"},
      {:redix, "~> 1.5"}
    ]
  end

  defp aliases do
    [
      setup: ["deps.get"],
      test: ["test --no-start"]
    ]
  end
end
