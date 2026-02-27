defmodule Gateway.Redis do
  use Supervisor

  def start_link(redis_url) do
    Supervisor.start_link(__MODULE__, redis_url, name: __MODULE__)
  end

  @impl true
  def init(redis_url) do
    children = [
      {Redix, {redis_url, [name: Gateway.Redix]}}
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end
end
